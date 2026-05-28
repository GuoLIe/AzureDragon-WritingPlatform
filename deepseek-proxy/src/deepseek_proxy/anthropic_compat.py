"""
Anthropic Messages API 兼容端点

提供与 api.deepseek.com/anthropic/v1/messages 一致的接口：
- POST /anthropic/v1/messages

转换流程:
  Anthropic 请求 → OpenAI 请求 → DeepSeek 网页 API → full_sse_pipeline → Anthropic SSE
"""

from __future__ import annotations

import json
import re
import uuid
import logging
from typing import Optional, Any

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from .server import get_state
from .sse_parser import full_sse_pipeline


logger = logging.getLogger("deepseek_proxy")
router = APIRouter(prefix="/anthropic/v1")

# DeepSeek 模型名 → 内部模型名
_MODEL_MAP = {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-pro",
}


# ═══════════════════════════════════════════════════════════
# 请求转换: Anthropic → OpenAI
# ═══════════════════════════════════════════════════════════

def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            if btype == "text":
                parts.append(block.get("text", ""))
            elif btype == "tool_result":
                parts.append(_content_to_text(block.get("content", "")))
        return "\n".join(parts)
    return str(content)


def _anthropic_to_openai(body: dict) -> dict:
    messages = []

    system = body.get("system")
    if system:
        system_text = _content_to_text(system)
        if system_text:
            messages.append({"role": "system", "content": system_text})

    for msg in body.get("messages", []):
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if isinstance(content, str):
            messages.append({"role": role, "content": content})
            continue

        if not isinstance(content, list):
            messages.append({"role": role, "content": str(content)})
            continue

        if role == "assistant":
            tool_calls = []
            text_parts = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use":
                    raw_id = block.get("id", "")
                    oai_id = raw_id[6:] if raw_id.startswith("toolu_") else raw_id
                    tool_calls.append({
                        "id": oai_id,
                        "type": "function",
                        "function": {
                            "name": block.get("name", ""),
                            "arguments": json.dumps(block.get("input", {}), ensure_ascii=False),
                        },
                    })
                elif block.get("type") == "text":
                    text_parts.append(block.get("text", ""))

            if tool_calls:
                messages.append({
                    "role": "assistant",
                    "content": "\n".join(text_parts) if text_parts else None,
                    "tool_calls": tool_calls,
                })
            else:
                messages.append({"role": "assistant", "content": "\n".join(text_parts)})

        elif role == "user":
            has_tool_result = any(
                isinstance(b, dict) and b.get("type") == "tool_result"
                for b in content
            )
            if has_tool_result:
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_result":
                        tool_content = _content_to_text(block.get("content", ""))
                        result_id = block.get("tool_use_id", "")
                        if result_id.startswith("toolu_"):
                            result_id = result_id[6:]
                        messages.append({
                            "role": "tool",
                            "content": tool_content or "",
                            "tool_call_id": result_id,
                        })
                    elif block.get("type") == "text":
                        messages.append({"role": "user", "content": block.get("text", "")})
            else:
                messages.append({"role": "user", "content": _content_to_text(content)})
        else:
            messages.append({"role": role, "content": _content_to_text(content)})

    openai_body = {
        "model": body.get("model", "deepseek-chat"),
        "messages": messages,
        "stream": body.get("stream", False),
    }

    if "max_tokens" in body:
        openai_body["max_tokens"] = body["max_tokens"]
    if "temperature" in body:
        openai_body["temperature"] = body["temperature"]
    if "top_p" in body:
        openai_body["top_p"] = body["top_p"]
    if body.get("stop_sequences"):
        openai_body["stop"] = body["stop_sequences"]

    if body.get("tools"):
        openai_body["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {}),
                },
            }
            for t in body["tools"]
        ]

    if body.get("tool_choice"):
        tc = body["tool_choice"]
        if isinstance(tc, dict):
            openai_body["tool_choice"] = {
                "type": "function",
                "function": {"name": tc.get("name", "")},
            }
        elif isinstance(tc, str):
            openai_body["tool_choice"] = tc

    return openai_body


# ═══════════════════════════════════════════════════════════
# 健壮的 tool_calls 提取
# ═══════════════════════════════════════════════════════════

def _extract_tool_calls(content: str) -> tuple[str, list[dict]]:
    """从内容中提取 <tool_calls> 块, 返回 (前文, 工具调用列表)"""
    match = re.search(r"<tool_calls>(.*?)</tool_calls>", content, re.DOTALL)
    if not match:
        return content, []

    before = content[:match.start()].strip()
    raw_json = match.group(1).strip()

    # 策略1: 直接 JSON 解析
    try:
        parsed = json.loads(raw_json)
        if isinstance(parsed, list):
            return before, parsed
        if isinstance(parsed, dict):
            return before, [parsed]
    except (json.JSONDecodeError, ValueError):
        pass

    # 策略2: 逐对象提取 (容错: 正则匹配 {name:..., arguments:{...}})
    tools2 = []
    for m in re.finditer(
        r'\{\s*"name"\s*:\s*"([^"]*)"[^}]*"arguments"\s*:\s*(\{.*?\})\s*\}',
        raw_json, re.DOTALL,
    ):
        name = m.group(1)
        try:
            args = json.loads(m.group(2))
        except (json.JSONDecodeError, ValueError):
            args = {}
        tools2.append({"name": name, "arguments": args})

    # 如果策略2 成功解析了 arguments, 直接返回
    if tools2 and any(t.get("arguments") for t in tools2):
        return before, tools2

    # 策略3: 字符级解析 (容错: 处理未转义引号)
    tools = _parse_malformed_tool_calls(raw_json)
    return before, tools


def _parse_malformed_tool_calls(raw: str) -> list[dict]:
    """字符级解析 tool_calls JSON, 容忍未转义引号"""
    tools = []
    i = 0
    while i < len(raw):
        # 寻找 "name"
        nm = re.search(r'"name"\s*:\s*"', raw[i:])
        if not nm:
            break
        i += nm.end()
        # 读取 name 值 (name 通常是安全的)
        name_end = raw.find('"', i)
        if name_end < 0:
            break
        name = raw[i:name_end]
        i = name_end + 1

        # 寻找 "arguments"
        am = re.search(r'"arguments"\s*:\s*\{', raw[i:])
        if not am:
            tools.append({"name": name, "arguments": {}})
            continue
        i += am.end()

        # 解析 arguments 内的 "key": "value" 对
        args = {}
        depth = 1  # 已经在 { 内
        while i < len(raw) and depth > 0:
            c = raw[i]
            if c in ' \t\n\r,':
                i += 1
                continue
            if c == '}':
                depth -= 1
                i += 1
                continue
            if c == '{':
                depth += 1
                i += 1
                continue

            # 寻找 "key":
            km = re.match(r'"(\w+)"\s*:\s*', raw[i:])
            if not km:
                i += 1
                continue
            key = km.group(1)
            i += km.end()

            if raw[i] == '"':
                # 字符串值: 找到终止引号 (后面跟 , 或 } 或 ])
                i += 1  # 跳过开始引号
                val_start = i
                while i < len(raw):
                    qi = raw.find('"', i)
                    if qi < 0:
                        args[key] = raw[val_start:]
                        i = len(raw)
                        break
                    rest = raw[qi + 1:].lstrip()
                    if rest and rest[0] in ',}]\n\r':
                        args[key] = raw[val_start:qi]
                        i = qi + 1
                        break
                    # 未转义引号, 跳过
                    i = qi + 1
            elif raw[i] == '{':
                # 对象值: 跳过整个对象
                obj_start = i
                obj_depth = 0
                while i < len(raw):
                    if raw[i] == '{':
                        obj_depth += 1
                    elif raw[i] == '}':
                        obj_depth -= 1
                        if obj_depth == 0:
                            i += 1
                            break
                    elif raw[i] == '"':
                        qi = raw.find('"', i + 1)
                        if qi < 0:
                            break
                        i = qi
                    i += 1
                args[key] = raw[obj_start:i]
            elif raw[i] in '0123456789tfn':
                # 数字/布尔/null
                val_start = i
                while i < len(raw) and raw[i] not in ',}\n\r':
                    i += 1
                args[key] = raw[val_start:i].strip()
            else:
                i += 1

        tools.append({"name": name, "arguments": args})

    return tools


# ═══════════════════════════════════════════════════════════
# 响应构建
# ═══════════════════════════════════════════════════════════

_FINISH_MAP = {
    "stop": "end_turn",
    "length": "max_tokens",
    "tool_calls": "tool_use",
    "content_filter": "end_turn",
}


def _stop_reason(finish_reason: Optional[str], has_tool_calls: bool) -> str:
    if has_tool_calls:
        return "tool_use"
    return _FINISH_MAP.get(finish_reason or "stop", "end_turn")


def _build_response(
    content_blocks: list[dict],
    model: str,
    finish_reason: Optional[str],
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> dict:
    if not content_blocks:
        content_blocks = [{"type": "text", "text": ""}]
    has_tc = any(b.get("type") == "tool_use" for b in content_blocks)
    return {
        "id": f"msg_{uuid.uuid4().hex[:24]}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content_blocks,
        "stop_reason": _stop_reason(finish_reason, has_tc),
        "stop_sequence": None,
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
    }


# ═══════════════════════════════════════════════════════════
# SSE 辅助
# ═══════════════════════════════════════════════════════════

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ═══════════════════════════════════════════════════════════
# 流式转换: OpenAI Chunk → Anthropic SSE
# ═══════════════════════════════════════════════════════════

async def _openai_to_anthropic_stream(openai_chunks, model: str):
    """将 full_sse_pipeline 输出的 OpenAI ChatCompletionChunk 转为 Anthropic SSE"""
    msg_id = f"msg_{uuid.uuid4().hex[:24]}"
    message_started = False
    thinking_started = False
    text_started = False
    active_block: Optional[dict] = None
    active_block_type: Optional[str] = None  # "thinking", "text", "tool_use"
    next_index = 0
    output_tokens = 0
    current_tool_idx = -1  # 跟踪当前正在处理的 tool_call index
    current_tool_id: Optional[str] = None
    current_tool_name: Optional[str] = None

    def _close_active() -> list[str]:
        nonlocal active_block, active_block_type
        evts = []
        if active_block is not None:
            evts.append(_sse("content_block_stop", {
                "type": "content_block_stop",
                "index": active_block["index"],
            }))
            active_block = None
            active_block_type = None
        return evts

    def _ensure_message() -> list[str]:
        nonlocal message_started
        if message_started:
            return []
        message_started = True
        return [_sse("message_start", {
            "type": "message_start",
            "message": {
                "id": msg_id, "type": "message", "role": "assistant",
                "model": model, "content": [],
                "stop_reason": None, "stop_sequence": None,
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        })]

    def _open_block(btype: str, extra: dict | None = None) -> list[str]:
        nonlocal active_block, active_block_type, next_index
        evts = _close_active()
        evts.extend(_ensure_message())
        idx = next_index
        next_index += 1
        active_block = {"type": btype, "index": idx}
        active_block_type = btype
        bd = {"type": btype}
        if extra:
            bd.update(extra)
        evts.append(_sse("content_block_start", {
            "type": "content_block_start", "index": idx,
            "content_block": bd,
        }))
        return evts

    def _emit_delta(dd: dict) -> list[str]:
        if active_block is None:
            return []
        return [_sse("content_block_delta", {
            "type": "content_block_delta",
            "index": active_block["index"], "delta": dd,
        })]

    try:
        async for chunk in openai_chunks:
            choice = chunk.get("choices", [{}])[0] if chunk.get("choices") else {}
            delta = choice.get("delta", {})

            # usage 事件 (无 choices)
            if chunk.get("usage") and not chunk.get("choices"):
                output_tokens = chunk["usage"].get("completion_tokens", output_tokens)
                continue

            # thinking (reasoning_content)
            if delta.get("reasoning_content"):
                text = delta["reasoning_content"]
                if not thinking_started:
                    thinking_started = True
                    for e in _open_block("thinking", {"thinking": ""}):
                        yield e
                for e in _emit_delta({"type": "thinking_delta", "thinking": text}):
                    yield e

            # text content
            if delta.get("content"):
                text = delta["content"]
                if not text_started:
                    text_started = True
                    if thinking_started and active_block_type == "thinking":
                        for e in _close_active():
                            yield e
                    for e in _open_block("text", {"text": ""}):
                        yield e
                for e in _emit_delta({"type": "text_delta", "text": text}):
                    yield e

            # tool_calls (增量)
            for tc in delta.get("tool_calls", []):
                tc_index = tc.get("index", 0)
                func = tc.get("function", {})
                tc_name = func.get("name", "")
                tc_args = func.get("arguments", "")
                raw_id = tc.get("id", "")

                logger.info("Tool call delta: index=%d name=%s id=%s args_len=%d",
                            tc_index, tc_name, raw_id, len(tc_args))

                # 新的 tool_call (不同 index 或有新 id)
                if tc_index != current_tool_idx or (raw_id and raw_id != current_tool_id):
                    # 关闭之前的 tool_use block
                    if active_block_type == "tool_use":
                        for e in _close_active():
                            yield e
                    current_tool_idx = tc_index
                    current_tool_id = raw_id
                    current_tool_name = tc_name or current_tool_name or ""
                    tc_id = f"toolu_{raw_id}" if raw_id and not raw_id.startswith("toolu_") else (raw_id or f"toolu_{uuid.uuid4().hex[:24]}")
                    logger.info("Emitting tool_use block: id=%s name=%s", tc_id, current_tool_name)
                    for e in _open_block("tool_use", {
                        "id": tc_id, "name": current_tool_name, "input": {},
                    }):
                        yield e

                # 累积 arguments delta
                if tc_name:
                    current_tool_name = tc_name
                if tc_args:
                    for e in _emit_delta({
                        "type": "input_json_delta", "partial_json": tc_args,
                    }):
                        yield e

            # finish
            finish = choice.get("finish_reason")
            if finish:
                for e in _close_active():
                    yield e

                # 空响应兜底
                if not text_started and not thinking_started:
                    for e in _open_block("text", {"text": ""}):
                        yield e
                    for e in _close_active():
                        yield e

                sr = _stop_reason(finish, active_block_type == "tool_use" or current_tool_idx >= 0)
                yield _sse("message_delta", {
                    "type": "message_delta",
                    "delta": {"stop_reason": sr, "stop_sequence": None},
                    "usage": {"output_tokens": output_tokens},
                })
                yield _sse("message_stop", {"type": "message_stop"})
                return

    except Exception:
        import traceback
        traceback.print_exc()
        yield _sse("error", {
            "type": "error",
            "error": {"type": "api_error", "message": "Stream processing error"},
        })


# ═══════════════════════════════════════════════════════════
# 端点
# ═══════════════════════════════════════════════════════════

@router.post("/messages")
async def anthropic_messages(request: Request):
    state = get_state()

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    model = body.get("model", "deepseek-chat")
    stream = body.get("stream", False)
    new_chat = body.get("new_chat", False)
    session_id = body.get("session_id")

    if not body.get("messages"):
        raise HTTPException(status_code=400, detail="messages is required")
    if "max_tokens" not in body:
        raise HTTPException(status_code=400, detail="max_tokens is required")

    internal_model = _MODEL_MAP.get(model, model)
    openai_body = _anthropic_to_openai(body)

    logger.info(
        "Anthropic request: model=%s stream=%s tools=%d messages=%d",
        model, stream,
        len(openai_body.get("tools", [])),
        len(openai_body["messages"]),
    )

    try:
        resp = await state.adapter.chat(
            messages=openai_body["messages"],
            model=internal_model,
            stream=stream,
            tools=openai_body.get("tools"),
            tool_choice=openai_body.get("tool_choice"),
            new_chat=new_chat,
            session_id=session_id,
        )
    except Exception as e:
        logger.error("Anthropic chat failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    if not stream:
        # 非流式: 通过 pipeline 收集, 再转 Anthropic
        content_blocks = []
        reasoning_text = ""
        finish = None
        input_tokens = 0
        output_tokens = 0

        chunk_count = 0
        async for chunk in full_sse_pipeline(resp.aiter_bytes(), model=model):
            chunk_count += 1
            choice = chunk.get("choices", [{}])[0] if chunk.get("choices") else {}
            delta = choice.get("delta", {})

            if chunk.get("usage") and not chunk.get("choices"):
                input_tokens = chunk["usage"].get("prompt_tokens", input_tokens)
                output_tokens = chunk["usage"].get("completion_tokens", output_tokens)
                continue

            if delta.get("reasoning_content"):
                reasoning_text += delta["reasoning_content"]

            if delta.get("content"):
                if reasoning_text and not any(b.get("type") == "thinking" for b in content_blocks):
                    content_blocks.insert(0, {"type": "thinking", "thinking": reasoning_text})
                text_block = next((b for b in content_blocks if b.get("type") == "text"), None)
                if text_block:
                    text_block["text"] += delta["content"]
                else:
                    content_blocks.append({"type": "text", "text": delta["content"]})

            for tc in delta.get("tool_calls", []):
                func = tc.get("function", {})
                raw_id = tc.get("id", "")
                tc_id = f"toolu_{raw_id}" if raw_id and not raw_id.startswith("toolu_") else (raw_id or f"toolu_{uuid.uuid4().hex[:24]}")
                try:
                    tc_input = json.loads(func.get("arguments", "{}"))
                except (json.JSONDecodeError, TypeError):
                    tc_input = {}
                content_blocks.append({
                    "type": "tool_use", "id": tc_id,
                    "name": func.get("name", ""), "input": tc_input,
                })

            if choice.get("finish_reason"):
                finish = choice["finish_reason"]

        logger.info("Non-stream done: chunks=%d blocks=%d", chunk_count, len(content_blocks))
        return JSONResponse(
            content=_build_response(content_blocks, model, finish, input_tokens, output_tokens),
            headers={"anthropic-version": "2023-06-01"},
        )

    # 流式: 通过 pipeline 转换
    async def event_stream():
        chunk_count = 0
        try:
            openai_chunks = full_sse_pipeline(resp.aiter_bytes(), model=model)
            async for event in _openai_to_anthropic_stream(openai_chunks, model):
                chunk_count += 1
                yield event
            logger.info("Anthropic stream done: chunks=%d", chunk_count)
        except Exception:
            import traceback
            traceback.print_exc()
            logger.error("Anthropic stream error after %d chunks", chunk_count)
            yield _sse("error", {
                "type": "error",
                "error": {"type": "api_error", "message": "Stream error"},
            })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "anthropic-version": "2023-06-01",
        },
    )
