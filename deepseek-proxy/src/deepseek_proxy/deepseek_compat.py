"""
DeepSeek 官方 API 兼容端点

提供与 api.deepseek.com 一致的接口：
- POST /chat/completions
- GET  /models
- GET  /user/balance
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from .server import get_state
from .sse_parser import full_sse_pipeline


router = APIRouter()

# DeepSeek 官方模型名 → 内部模型名 映射
_OFFICIAL_MODEL_MAP = {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-pro",
    "deepseek-coder": "deepseek-v4-flash",
}


@router.get("/models")
async def list_models():
    """返回 DeepSeek 官方格式模型列表"""
    return {
        "object": "list",
        "data": [
            {
                "id": "deepseek-chat",
                "object": "model",
                "owned_by": "deepseek",
                "created": 1700000000,
                "permission": [],
                "root": "deepseek-chat",
                "parent": None,
            },
            {
                "id": "deepseek-reasoner",
                "object": "model",
                "owned_by": "deepseek",
                "created": 1700000000,
                "permission": [],
                "root": "deepseek-reasoner",
                "parent": None,
            },
        ],
    }


@router.get("/user/balance")
async def user_balance():
    """返回模拟余额信息"""
    return {
        "is_available": True,
        "balance_infos": [
            {
                "currency": "CNY",
                "total_balance": "9999.00",
                "granted_balance": "9999.00",
                "topped_up_balance": "0.00",
            }
        ],
    }


@router.post("/chat/completions")
async def chat_completions(request: Request):
    """DeepSeek 官方格式的聊天补全端点"""
    state = get_state()

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = body.get("messages", [])
    model = body.get("model", "deepseek-chat")
    stream = body.get("stream", False)
    tools = body.get("tools")
    tool_choice = body.get("tool_choice")
    response_format = body.get("response_format")
    web_search = body.get("web_search")
    reasoning_effort = body.get("reasoning_effort")
    new_chat = body.get("new_chat", False)
    session_id = body.get("session_id")

    if not messages:
        raise HTTPException(status_code=400, detail="messages is required")

    # 将官方模型名映射为内部模型名
    internal_model = _OFFICIAL_MODEL_MAP.get(model, model)

    try:
        resp = await state.adapter.chat(
            messages=messages,
            model=internal_model,
            stream=stream,
            tools=tools,
            tool_choice=tool_choice,
            response_format=response_format,
            web_search=web_search,
            reasoning_effort=reasoning_effort,
            new_chat=new_chat,
            session_id=session_id,
        )
    except Exception as e:
        import logging
        logging.getLogger("deepseek_proxy").error("Chat failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    chat_id = f"chatcmpl-{uuid.uuid4().hex[:29]}"
    created = int(time.time())

    if not stream:
        # 非流式: 累积内容后返回
        full_content = ""
        full_reasoning = ""
        async for chunk in full_sse_pipeline(
            resp.aiter_bytes(),
            model=model,
        ):
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            if delta.get("content"):
                full_content += delta["content"]
            if delta.get("reasoning_content"):
                full_reasoning += delta["reasoning_content"]

        result = {
            "id": chat_id,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": full_content,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        }

        # reasoner 模型返回 reasoning_content
        if full_reasoning:
            result["choices"][0]["message"]["reasoning_content"] = full_reasoning

        return result

    # 流式: SSE 响应
    async def event_stream():
        try:
            async for chunk in full_sse_pipeline(
                resp.aiter_bytes(),
                model=model,
            ):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception:
            import traceback
            traceback.print_exc()
            error_chunk = {
                "error": {"message": "Stream error", "type": "server_error"}
            }
            yield f"data: {json.dumps(error_chunk)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
