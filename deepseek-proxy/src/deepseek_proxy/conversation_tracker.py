"""
对话追踪器 — 拦截请求日志 + Web UI + 手动控制是否继续对话

自包含模块, 仅在 server.py 中挂载端点, 不修改核心 session/adapter 逻辑。
"""

from __future__ import annotations

import json
import time
import logging
import threading
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse

logger = logging.getLogger("deepseek_proxy")


# ═══════════════════════════════════════════════════════════
# 请求日志
# ═══════════════════════════════════════════════════════════

@dataclass
class RequestLog:
    id: int
    prompt: str
    model: str
    model_type: str
    thinking: bool
    search: bool
    continue_conversation: bool
    timestamp: float = field(default_factory=time.time)
    status: str = "pending"       # pending / streaming / done / error
    session_id: Optional[str] = None
    message_id: Optional[int] = None
    error: Optional[str] = None


class ConversationTracker:
    """请求日志 + 会话状态追踪"""

    def __init__(self):
        self._lock = threading.Lock()
        self._logs: list[RequestLog] = []
        self._next_id = 1
        # 会话状态 (每个 model_type)
        self._sessions: dict[str, str] = {}   # model_type → session_id
        self._msg_ids: dict[str, int] = {}    # model_type → 最新 assistant message_id
        # "继续对话" toggle 状态 (每个 model_type)
        self._continue_state: dict[str, bool] = {}  # model_type → 是否继续

    def log_request(self, prompt: str, model: str, model_type: str,
                    thinking: bool, search: bool,
                    continue_conversation: bool) -> RequestLog:
        with self._lock:
            entry = RequestLog(
                id=self._next_id,
                prompt=prompt[:200],
                model=model,
                model_type=model_type,
                thinking=thinking,
                search=search,
                continue_conversation=continue_conversation,
            )
            self._next_id += 1
            self._logs.append(entry)
            if len(self._logs) > 200:
                self._logs = self._logs[-200:]
            return entry

    def update_status(self, entry: RequestLog, status: str,
                      session_id: str = None, message_id: int = None,
                      error: str = None):
        with self._lock:
            entry.status = status
            if session_id is not None:
                entry.session_id = session_id
            if message_id is not None:
                entry.message_id = message_id
            if error is not None:
                entry.error = error

    def set_session(self, model_type: str, session_id: str, message_id: int):
        with self._lock:
            self._sessions[model_type] = session_id
            self._msg_ids[model_type] = message_id

    def get_session(self, model_type: str) -> tuple[Optional[str], Optional[int]]:
        with self._lock:
            return self._sessions.get(model_type), self._msg_ids.get(model_type)

    # --- 继续对话 toggle ---

    def set_continue(self, model_type: str, enabled: bool):
        with self._lock:
            self._continue_state[model_type] = enabled

    def get_continue(self, model_type: str) -> bool:
        with self._lock:
            return self._continue_state.get(model_type, False)

    def get_continue_states(self) -> dict[str, bool]:
        with self._lock:
            return dict(self._continue_state)

    def clear_session(self, model_type: str):
        with self._lock:
            self._sessions.pop(model_type, None)
            self._msg_ids.pop(model_type, None)
            self._continue_state.pop(model_type, None)

    def get_logs(self) -> list[dict]:
        with self._lock:
            return [{
                "id": e.id,
                "prompt": e.prompt,
                "model": e.model,
                "model_type": e.model_type,
                "thinking": e.thinking,
                "search": e.search,
                "continue_conversation": e.continue_conversation,
                "timestamp": e.timestamp,
                "status": e.status,
                "session_id": e.session_id,
                "message_id": e.message_id,
                "error": e.error,
            } for e in reversed(self._logs)]


# ═══════════════════════════════════════════════════════════
# SSE 流包装: 提取 message_id
# ═══════════════════════════════════════════════════════════

class _SSEMessageIdCapture:
    """包装字节流, 从首个 SSE 事件的快照中提取 message_id, 然后透传全部字节"""

    def __init__(self, byte_stream, on_message_id):
        self._stream = byte_stream
        self._on_message_id = on_message_id

    def aiter_bytes(self):
        return self._generate()

    async def _generate(self):
        buf = b""
        found = False
        async for chunk in self._stream.aiter_bytes():
            if not found:
                buf += chunk
                if b"\n\n" in buf:
                    self._extract(buf)
                    found = True
            yield chunk
        if not found and buf:
            self._extract(buf)

    def _extract(self, raw: bytes):
        try:
            text = raw.decode("utf-8", errors="replace")
            for line in text.split("\n"):
                line = line.strip()
                if line.startswith("data:"):
                    data = json.loads(line[5:].strip())
                    mid = _find_msg_id(data)
                    if mid is not None:
                        self._on_message_id(mid)
                        return
        except Exception:
            pass


def _find_msg_id(data) -> Optional[int]:
    if isinstance(data, dict):
        if "message_id" in data:
            v = data["message_id"]
            return int(v) if v is not None else None
        for key in ("v", "response"):
            if key in data:
                r = _find_msg_id(data[key])
                if r is not None:
                    return r
        for v in data.values():
            if isinstance(v, dict):
                r = _find_msg_id(v)
                if r is not None:
                    return r
    return None


# ═══════════════════════════════════════════════════════════
# Web UI 路由
# ═══════════════════════════════════════════════════════════

router = APIRouter()
_tracker: Optional[ConversationTracker] = None


def get_tracker() -> ConversationTracker:
    global _tracker
    if _tracker is None:
        _tracker = ConversationTracker()
    return _tracker


@router.get("/ui")
async def web_ui():
    return HTMLResponse(content=_HTML)


@router.get("/api/requests")
async def list_requests():
    tracker = get_tracker()
    return {
        "requests": tracker.get_logs(),
        "continue_states": tracker.get_continue_states(),
    }


@router.post("/api/continue/{model_type}")
async def toggle_continue(model_type: str, request: Request):
    body = await request.json()
    enabled = body.get("enabled", False)
    get_tracker().set_continue(model_type, bool(enabled))
    return {"ok": True, "model_type": model_type, "enabled": enabled}


@router.post("/api/clear/{model_type}")
async def clear_session(model_type: str):
    get_tracker().clear_session(model_type)
    return {"ok": True, "model_type": model_type}


# ═══════════════════════════════════════════════════════════
# HTML
# ═══════════════════════════════════════════════════════════

_HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DeepSeek Proxy - 请求日志</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;color:#333}
.header{background:#fff;border-bottom:1px solid #e0e0e0;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:18px;font-weight:600}
.header .info{font-size:13px;color:#888}
.container{max-width:960px;margin:0 auto;padding:16px}
.controls{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.controls label{font-size:13px;color:#555;font-weight:500}
.controls .hint{font-size:12px;color:#999}
.table-wrap{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 12px;background:#fafafa;border-bottom:1px solid #e8e8e8;font-weight:500;color:#666;font-size:12px}
td{padding:10px 12px;border-bottom:1px solid #f0f0f0;vertical-align:middle}
tr:hover{background:#f8faff}
.prompt{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.time{color:#999;font-size:12px;white-space:nowrap}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
.badge-pending{background:#fff3cd;color:#856404}
.badge-streaming{background:#cce5ff;color:#004085}
.badge-done{background:#d4edda;color:#155724}
.badge-error{background:#f8d7da;color:#721c24}
.toggle{position:relative;width:36px;height:20px;display:inline-block;cursor:pointer}
.toggle input{opacity:0;width:0;height:0}
.toggle .slider{position:absolute;inset:0;background:#ccc;border-radius:20px;transition:.2s}
.toggle .slider:before{content:"";position:absolute;height:14px;width:14px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
.toggle input:checked+.slider{background:#1a73e8}
.toggle input:checked+.slider:before{transform:translateX(16px)}
.btn{display:inline-block;padding:5px 14px;border-radius:6px;border:1px solid #d0d0d0;background:#fff;font-size:12px;cursor:pointer;color:#333;transition:.15s}
.btn:hover{background:#f0f0f0}
.btn-danger{color:#dc3545;border-color:#dc3545}
.btn-danger:hover{background:#fff0f0}
.empty{text-align:center;padding:60px 0;color:#999;font-size:14px}
.empty2{color:#bbb;font-size:13px;margin-top:8px}
</style>
</head>
<body>
<div class="header">
  <h1>DeepSeek 请求日志</h1>
  <span class="info" id="count"></span>
</div>
<div class="container">
  <div class="controls" id="controls" style="display:none"></div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th style="width:60px">ID</th>
        <th>请求内容</th>
        <th style="width:80px">模型</th>
        <th style="width:70px">状态</th>
        <th style="width:80px">继续对话</th>
        <th style="width:100px">时间</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
    <div class="empty" id="empty">暂无请求记录<div class="empty2">通过 API 发送请求后会自动显示在这里</div></div>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);
let lastKey='';

async function load(){
  try{
    const r=await fetch('/api/requests');
    const d=await r.json();
    const key=JSON.stringify(d);
    if(key!==lastKey){
      lastKey=key;
      render(d.requests||[]);
      renderControls(d.requests||[],d.continue_states||{});
    }
  }catch(e){}
}

function getModelTypes(items){
  const s=new Set();
  const map={};
  items.forEach(r=>{
    const mt=r.model_type||r.model;
    if(mt){s.add(mt);if(r.model)map[mt]=r.model;}
  });
  return{types:[...s],names:map};
}

function renderControls(items,states){
  const{types,names}=getModelTypes(items);
  const el=$('#controls');
  if(!types.length){el.style.display='none';return;}
  el.style.display='flex';
  el.innerHTML=types.map(mt=>{
    const on=!!states[mt];
    const label=names[mt]||mt;
    return '<label>'+esc(label)+'</label>'+
      '<label class="toggle">'+
      '<input type="checkbox" '+(on?'checked':'')+' onchange="toggleContinue(\''+esc(mt)+'\',this.checked)">'+
      '<span class="slider"></span></label>'+
      '<button class="btn btn-danger" onclick="clearSession(\''+esc(mt)+'\')">清除会话</button>';
  }).join('');
}

async function toggleContinue(mt,on){
  try{await fetch('/api/continue/'+encodeURIComponent(mt),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:on})});}catch(e){}
}

async function clearSession(mt){
  if(!confirm('清除 '+mt+' 的会话?'))return;
  try{await fetch('/api/clear/'+encodeURIComponent(mt),{method:'POST'});load();}catch(e){}
}

function render(items){
  $('#empty').style.display=items.length?'none':'block';
  $('#count').textContent=items.length?'共 '+items.length+' 条请求':'';
  $('#tbody').innerHTML=items.map(r=>{
    const t=new Date(r.timestamp*1000);
    const ts=t.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const cls='badge badge-'+r.status;
    const checked=r.continue_conversation?'checked':'';
    return '<tr>'+
      '<td style="color:#999">'+r.id+'</td>'+
      '<td class="prompt" title="'+esc(r.prompt)+'">'+esc(r.prompt)+'</td>'+
      '<td>'+esc(r.model)+'</td>'+
      '<td><span class="'+cls+'">'+r.status+'</span></td>'+
      '<td><label class="toggle"><input type="checkbox" '+checked+' disabled><span class="slider"></span></label></td>'+
      '<td class="time">'+ts+'</td>'+
    '</tr>';
  }).join('');
}

function esc(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

load();
setInterval(load,2000);
</script>
</body>
</html>"""
