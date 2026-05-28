"""
DeepSeek Proxy — 兼容模式入口

同时提供：
- DeepSeek 官方兼容端点: /chat/completions, /models, /user/balance
- 原有 OpenAI 兼容端点: /v1/chat/completions, /v1/models, /health

Usage:
    uv run deepseek-proxy-compat
"""

import json
import logging
import asyncio

from .config import CONFIG
from .server import init_server, shutdown_server, create_app
from .deepseek_compat import router as compat_router
from .anthropic_compat import router as anthropic_router


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


async def main():
    setup_logging()
    logger = logging.getLogger("deepseek_proxy")

    logger.info("启动 DeepSeek Proxy (兼容模式)...")
    logger.info("认证模式: %s", CONFIG.auth_mode.value)
    logger.info("会话模式: %s", CONFIG.session_mode.value)
    logger.info("服务器: %s:%d", CONFIG.server_host, CONFIG.server_port)
    logger.info("端点: /chat/completions + /anthropic/v1/messages + /v1/*")

    # 初始化全局状态
    state = await init_server(CONFIG)

    # 获取原始 app (含 /v1/* 端点 + auth 中间件)
    original_app = create_app(CONFIG)

    # 创建顶层 app
    from fastapi import FastAPI, Request, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse

    app = FastAPI(
        title="DeepSeek Proxy (兼容模式)",
        description="DeepSeek 官方 API 兼容 + OpenAI 兼容",
        version="1.0.0",
    )

    # 先注册兼容 router (优先匹配)
    app.include_router(compat_router)
    app.include_router(anthropic_router)

    # 兼容直接 POST / 的应用 (转发到 /v1/chat/completions)
    @app.post("/")
    async def root_chat_completions(request: Request):
        from .server import get_state
        from .sse_parser import full_sse_pipeline

        state = get_state()
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        messages = body.get("messages", [])
        model = body.get("model", state.config.default_model.value)
        stream = body.get("stream", True)
        new_chat = body.get("new_chat", False)
        session_id = body.get("session_id")

        if not messages:
            raise HTTPException(status_code=400, detail="messages is required")

        try:
            resp = await state.adapter.chat(
                messages=messages, model=model, stream=stream,
                tools=body.get("tools"), tool_choice=body.get("tool_choice"),
                response_format=body.get("response_format"),
                new_chat=new_chat, session_id=session_id,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not stream:
            full_content = ""
            async for chunk in full_sse_pipeline(resp.aiter_bytes(), model=model):
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                if delta.get("content"):
                    full_content += delta["content"]
            return {
                "id": f"chatcmpl-{id(full_content)}",
                "object": "chat.completion", "model": model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": full_content}, "finish_reason": "stop"}],
            }

        async def stream_gen():
            async for chunk in full_sse_pipeline(resp.aiter_bytes(), model=model):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(stream_gen(), media_type="text/event-stream")

    # 非流式聊天端点 (默认 stream=False)
    @app.post("/v1/chat")
    async def v1_chat_nonstream(request: Request):
        from .server import get_state
        from .sse_parser import full_sse_pipeline

        state = get_state()
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        messages = body.get("messages", [])
        model = body.get("model", state.config.default_model.value)
        stream = body.get("stream", False)
        new_chat = body.get("new_chat", False)
        session_id = body.get("session_id")

        if not messages:
            raise HTTPException(status_code=400, detail="messages is required")

        try:
            resp = await state.adapter.chat(
                messages=messages, model=model, stream=stream,
                tools=body.get("tools"), tool_choice=body.get("tool_choice"),
                response_format=body.get("response_format"),
                new_chat=new_chat, session_id=session_id,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not stream:
            full_content = ""
            async for chunk in full_sse_pipeline(resp.aiter_bytes(), model=model):
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                if delta.get("content"):
                    full_content += delta["content"]
            return {
                "id": f"chatcmpl-{id(full_content)}",
                "object": "chat.completion", "model": model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": full_content}, "finish_reason": "stop"}],
            }

        async def stream_gen():
            async for chunk in full_sse_pipeline(resp.aiter_bytes(), model=model):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(stream_gen(), media_type="text/event-stream")

    # 再挂载原始 app (处理 /v1/* 路径)
    app.mount("/", original_app)

    # CORS (顶层, 覆盖所有路由)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 启动 uvicorn
    import uvicorn
    from .server import open_browser
    config = uvicorn.Config(
        app,
        host=CONFIG.server_host,
        port=CONFIG.server_port,
        log_level="info",
    )
    server = uvicorn.Server(config)

    # 自动打开 Web UI
    open_browser(CONFIG)

    try:
        await server.serve()
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("收到关闭信号...")
    finally:
        await shutdown_server()
        logger.info("DeepSeek Proxy 已关闭")


def cli():
    """命令行入口"""
    asyncio.run(main())
