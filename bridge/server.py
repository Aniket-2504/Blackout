import asyncio
import queue
import threading
import tkinter as tk
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

app = FastAPI()

class ThreadSafePrivacyHUD:
    def __init__(self):
        self.cmd_queue = queue.Queue()
        self.root = None
        self.canvas = None
        self.detail_text = None
        self.is_visible = False

    def start_gui(self):
        self.root = tk.Tk()
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-alpha', 0.88)
        self.root.attributes('-topmost', True)
        self.root.configure(bg='#020617')

        width = self.root.winfo_screenwidth()
        height = self.root.winfo_screenheight()

        self.canvas = tk.Canvas(self.root, width=width, height=height, bg='#020617', highlightthickness=0)
        self.canvas.pack(fill='both', expand=True)

        # Draw vertical polarization micro-louvers
        for x in range(0, width, 4):
            self.canvas.create_line(x, 0, x, height, fill="#0F172A", width=1)

        self.canvas.create_text(
            width // 2, height // 2 - 30,
            text="🛡️ DIRECTIONAL PRIVACY MASK ENGAGED",
            font=("Consolas", 28, "bold"),
            fill="#38BDF8"
        )
        
        self.detail_text = self.canvas.create_text(
            width // 2, height // 2 + 25,
            text="Scanning perimeter...",
            font=("Consolas", 15),
            fill="#94A3B8"
        )

        self.root.withdraw()
        self.root.after(50, self._process_queue)
        self.root.mainloop()

    def _process_queue(self):
        try:
            while not self.cmd_queue.empty():
                action, data = self.cmd_queue.get_nowait()
                if action == "SHOW" and not self.is_visible:
                    self.canvas.itemconfig(
                        self.detail_text,
                        text=f"Threat Vector: {data}\n[Polarized Filter Active | Snooper Obfuscation 100%]"
                    )
                    self.root.deiconify()
                    self.root.lift()
                    self.is_visible = True
                elif action == "HIDE" and self.is_visible:
                    self.root.withdraw()
                    self.is_visible = False
        except Exception as e:
            print(f"[HUD Error]: {e}")
        finally:
            if self.root:
                self.root.after(50, self._process_queue)

    def trigger_show(self, reason: str):
        self.cmd_queue.put(("SHOW", reason))

    def trigger_hide(self):
        self.cmd_queue.put(("HIDE", None))

hud = ThreadSafePrivacyHUD()
threading.Thread(target=hud.start_gui, daemon=True).start()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[Bridge] 🟢 iQOO 15 paired via Port 8000")
    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            reason = data.get("reason", "Secondary Observer Detected")

            if event in ["BLUR", "LOCKDOWN"]:
                hud.trigger_show(reason)
            elif event in ["RESTORE", "SAFE"]:
                hud.trigger_hide()
    except WebSocketDisconnect:
        print("[Bridge] 🔴 Phone disconnected.")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)