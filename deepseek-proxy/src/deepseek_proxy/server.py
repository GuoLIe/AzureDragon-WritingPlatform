"""
FastAPI HTTP 服务器 — OpenAI 兼容端点

端点:
- GET  /v1/models
- POST /v1/chat/completions
- GET  /health
- GET  /ui                    (请求日志 Web 界面)
- GET  /api/requests          (请求日志 API)
"""

from __future__ import annotations

import json
import asyncio
from typing import Optional, Any

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import ProxyConfig
from .client import DsClient, CompletionPayload
from .auth import create_auth_provider, AuthProvider
from .pow_solver import create_solver, PowSolver
from .sessions import (
    create_session_strategy, SessionStrategy,
    ReuseSessionStrategy, cleanup_session,
)
from .openai_adapter import OpenAIAdapter
from .sse_parser import full_sse_pipeline
from .conversation_tracker import get_tracker, router as tracker_router


# ═══════════════════════════════════════════════════════════
# 全局状态 (应用生命周期内)
# ═══════════════════════════════════════════════════════════

class AppState:
    def __init__(self, config: ProxyConfig):
        self.config = config
        self.client: Optional[DsClient] = None
        self.solver: Optional[PowSolver] = None
        self.auth: Optional[AuthProvider] = None
        self.token: Optional[str] = None
        self.session_strategy: Optional[SessionStrategy] = None
        self.adapter: Optional[OpenAIAdapter] = None

    async def init(self):
        """初始化所有组件"""
        import logging
        logger = logging.getLogger("deepseek_proxy")

        # 1. HTTP 客户端
        logger.info("初始化 HTTP 客户端...")
        self.client = DsClient(self.config)

        # 2. 认证
        logger.info("初始化认证 (mode=%s)...", self.config.auth_mode.value)
        self.auth = create_auth_provider(self.config, self.client)
        self.token = await self.auth.authenticate()
        logger.info("认证成功, token: %s...", self.token[:20])

        # 3. PoW 求解器
        logger.info("下载 WASM 并初始化 PoW 求解器...")
        self.solver = await create_solver(self.config.wasm_url)
        logger.info("PoW 求解器初始化完成")

        # 4. 会话策略
        logger.info("初始化会话策略 (mode=%s)...", self.config.session_mode.value)
        self.session_strategy = create_session_strategy(
            self.config, self.client, self.solver, self.token,
            self.config.model_types,
        )
        if isinstance(self.session_strategy, ReuseSessionStrategy):
            await self.session_strategy.init(self.config.model_types)
            logger.info("会话池初始化完成")

        # 5. 适配器
        self.adapter = OpenAIAdapter(self.config, self.session_strategy)

        logger.info("DeepSeek Proxy 初始化完成")

    async def shutdown(self):
        """清理资源"""
        if self.session_strategy:
            await self.session_strategy.cleanup()
        if self.client:
            await self.client.close()


_app_state: Optional[AppState] = None


def get_state() -> AppState:
    if _app_state is None:
        raise RuntimeError("AppState not initialized")
    return _app_state


def _extract_message_id(raw: bytes):
    """从 SSE 事件字节中提取 message_id, 遍历所有 data: 行"""
    text = raw.decode("utf-8", errors="replace")
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            try:
                data = json.loads(line[5:].strip())
                # event: ready 格式: {"response_message_id": 4}
                if "response_message_id" in data:
                    return data["response_message_id"]
                # 普通事件格式: {"v": {"response": {"message_id": 4}}}
                v = data.get("v", {})
                if isinstance(v, dict):
                    resp = v.get("response", {})
                    if isinstance(resp, dict) and "message_id" in resp:
                        return resp["message_id"]
            except Exception:
                pass
    return None


async def _wrap_extract_message_id(byte_stream, on_message_id):
    """包装字节流, 从首个 SSE 事件中提取 message_id, 然后透传全部字节"""
    buf = b""
    found = False
    async for chunk in byte_stream:
        if not found:
            buf += chunk
            if b"\n\n" in buf:
                parts = buf.split(b"\n\n")
                mid = _extract_message_id(parts[0])
                if mid is not None:
                    on_message_id(mid)
                found = True
        yield chunk
    if not found and buf:
        mid = _extract_message_id(buf)
        if mid is not None:
            on_message_id(mid)


# ═══════════════════════════════════════════════════════════
# FastAPI App
# ═══════════════════════════════════════════════════════════

def create_app(config: ProxyConfig) -> FastAPI:
    global _app_state

    app = FastAPI(
        title="DeepSeek Proxy",
        description="OpenAI-compatible API proxy for DeepSeek chat",
        version="0.1.0",
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 请求日志 & Web UI
    app.include_router(tracker_router)

    # API Key 验证中间件
    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        # 跳过 health endpoint
        if request.url.path == "/health":
            return await call_next(request)

        # 如果有配置 api_tokens 则验证
        state = _app_state
        if state and state.config.api_tokens:
            auth_header = request.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "").strip()

            if not token or token not in state.config.api_tokens:
                return JSONResponse(
                    status_code=401,
                    content={"error": {"message": "Invalid API key", "type": "auth_error"}},
                )

        return await call_next(request)

    # ── 端点 ─────────────────────────────────────────

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/v1/models")
    async def list_models():
        """返回可用模型列表"""
        models = [
            # 新默认模型 — DeepSeek-V4 Flash (快速, 替代 deepseek-chat)
            {"id": "deepseek-v4-flash", "object": "model", "owned_by": "deepseek"},
            # 思考模型 — DeepSeek-V4 Pro (深度推理, 替代 deepseek-reasoner)
            {"id": "deepseek-v4-pro", "object": "model", "owned_by": "deepseek"},
            # 向后兼容 — 映射到 deepseek-v4-flash (DeepSeek-V3.2, 即将弃用)
            {"id": "deepseek-chat", "object": "model", "owned_by": "deepseek"},
            # 向后兼容 — 映射到 deepseek-v4-pro (DeepSeek-R1, 即将弃用)
            {"id": "deepseek-reasoner", "object": "model", "owned_by": "deepseek"},
        ]
        # 根据配置添加旧模型变体 (向后兼容)
        for mt in _app_state.config.model_types if _app_state else ["default"]:
            if mt == "default":
                models.append({"id": "deepseek-v4-flash", "object": "model", "owned_by": "deepseek"})

        return {"object": "list", "data": models}

    @app.post("/v1/chat/completions")
    async def chat_completions(request: Request):
        """OpenAI 兼容的聊天补全端点"""
        state = get_state()

        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        messages = body.get("messages", [])
        model = body.get("model", state.config.default_model.value)
        stream = body.get("stream", True)
        tools = body.get("tools")
        tool_choice = body.get("tool_choice")
        response_format = body.get("response_format")
        web_search = body.get("web_search")
        reasoning_effort = body.get("reasoning_effort")
        continue_conversation = body.get("continue_conversation", None)

        if not messages:
            raise HTTPException(status_code=400, detail="messages is required")

        # 解析模型参数
        model_type, thinking_enabled, search_enabled = state.adapter._resolve_model(model)
        if reasoning_effort:
            thinking_enabled = True
        if web_search:
            search_enabled = True

        # 如果请求未显式指定 continue_conversation, 从 toggle 状态读取
        tracker = get_tracker()
        if continue_conversation is None:
            continue_conversation = tracker.get_continue(model_type)

        # 构建 prompt
        prompt = state.adapter.build_prompt(
            messages=messages, model=model,
            tools=tools, tool_choice=tool_choice,
            response_format=response_format,
        )

        import logging
        log = logging.getLogger("deepseek_proxy")
        log.info("Prompt built: len=%d tools=%d continue=%s",
                 len(prompt), len(tools) if tools else 0, continue_conversation)

        # 记录请求
        first_user_msg = ""
        for m in messages:
            if m.get("role") == "user":
                c = m.get("content", "")
                if isinstance(c, str):
                    first_user_msg = c[:80]
                break
        log_entry = tracker.log_request(
            prompt=first_user_msg, model=model, model_type=model_type,
            thinking=thinking_enabled, search=search_enabled,
            continue_conversation=continue_conversation,
        )

        # 决定执行方式
        tracked_sid, tracked_mid = tracker.get_session(model_type)

        # continue_conversation 时优先用 completion（积累历史）
        # 如果还没 tracked session, 从 REUSE 策略拿 session_id
        if continue_conversation and tracked_sid is None:
            from .sessions import ReuseSessionStrategy
            if isinstance(state.session_strategy, ReuseSessionStrategy):
                tracked_sid = state.session_strategy._sessions.get(model_type)

        use_continue = continue_conversation and tracked_sid is not None

        try:
            if use_continue:
                # 继续对话: 用 completion + 现有 session
                pow_challenge = await state.client.create_pow_challenge(
                    state.token, "/api/v0/chat/completion")
                pow_result = state.solver.solve(pow_challenge)
                payload = CompletionPayload(
                    chat_session_id=tracked_sid,
                    prompt=prompt,
                    parent_message_id=tracked_mid,
                    thinking_enabled=thinking_enabled,
                    search_enabled=search_enabled,
                )
                resp = await state.client.completion(
                    state.token, pow_result.to_header(), payload)
                tracker.update_status(log_entry, "streaming",
                                      session_id=tracked_sid)
            else:
                # 默认方式: 通过 adapter (REUSE edit_message 或 NEW create)
                resp = await state.adapter.chat(
                    messages=messages, model=model, stream=stream,
                    tools=tools, tool_choice=tool_choice,
                    response_format=response_format,
                    web_search=web_search, reasoning_effort=reasoning_effort,
                )
                # 记录 REUSE 模式的 session_id
                from .sessions import ReuseSessionStrategy
                if isinstance(state.session_strategy, ReuseSessionStrategy):
                    sid = state.session_strategy._sessions.get(model_type)
                    if sid:
                        tracker.update_status(log_entry, "streaming",
                                              session_id=sid)
        except Exception as e:
            log.error("Chat failed: %s", e)
            tracker.update_status(log_entry, "error", error=str(e))
            raise HTTPException(status_code=500, detail=str(e))

        # 继续对话: 从 SSE 流中提取真实 message_id
        msg_id_container = []  # 闭包容器, 用于从异步生成器中传出 message_id

        if not stream:
            # 非流式
            full_content = ""

            byte_iter = resp.aiter_bytes()
            if use_continue:
                byte_iter = _wrap_extract_message_id(byte_iter, msg_id_container.append)

            async for chunk in full_sse_pipeline(byte_iter, model=model):
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                if delta.get("content"):
                    full_content += delta["content"]

            tracker.update_status(log_entry, "done")
            if use_continue:
                new_mid = msg_id_container[0] if msg_id_container else (tracked_mid or 1) + 2
                tracker.set_session(model_type, tracked_sid, new_mid)

            return {
                "id": f"chatcmpl-{id(full_content)}",
                "object": "chat.completion",
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": full_content},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            }

        # 流式
        sid_for_continue = tracked_sid if use_continue else None

        byte_iter = resp.aiter_bytes()
        if use_continue:
            byte_iter = _wrap_extract_message_id(byte_iter, msg_id_container.append)

        async def event_stream():
            try:
                async for chunk in full_sse_pipeline(byte_iter, model=model):
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                tracker.update_status(log_entry, "done")
                if use_continue and sid_for_continue:
                    new_mid = msg_id_container[0] if msg_id_container else (tracked_mid or 1) + 2
                    tracker.set_session(model_type, sid_for_continue, new_mid)
            except Exception:
                import traceback
                traceback.print_exc()
                tracker.update_status(log_entry, "error", error="Stream error")
                yield f"data: {json.dumps({'error': {'message': 'Stream error', 'type': 'server_error'}})}\n\n"
                yield "data: [DONE]\n\n"
            finally:
                session_id = getattr(resp, "_session_id", None)
                if session_id:
                    await cleanup_session(state.client, state.token, session_id)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return app


# ═══════════════════════════════════════════════════════════
# 初始化入口 (在 main.py 中调用)
# ═══════════════════════════════════════════════════════════

async def init_server(config: ProxyConfig):
    global _app_state
    _app_state = AppState(config)
    await _app_state.init()
    return _app_state


async def shutdown_server():
    if _app_state:
        await _app_state.shutdown()


def open_browser(config: ProxyConfig):
    """在默认浏览器中打开 Web UI"""
    import webbrowser
    import logging
    logger = logging.getLogger("deepseek_proxy")
    url = f"http://{config.server_host}:{config.server_port}/ui"
    logger.info("打开浏览器: %s", url)
    webbrowser.open(url)