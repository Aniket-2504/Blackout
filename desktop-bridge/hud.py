"""
Thread-safe Tkinter overlay. Runs on its own thread because Tkinter is
not safe to drive directly from asyncio/FastAPI's event loop thread.
Communication in is via a queue; nothing here reaches back into the
websocket code.
"""

import queue
import tkinter as tk


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

        for x in range(0, width, 4):
            self.canvas.create_line(x, 0, x, height, fill="#0F172A", width=1)

        self.canvas.create_text(
            width // 2, height // 2 - 30,
            text="🛡️ DIRECTIONAL PRIVACY MASK ENGAGED",
            font=("Consolas", 28, "bold"), fill="#38BDF8"
        )
        self.detail_text = self.canvas.create_text(
            width // 2, height // 2 + 25,
            text="Scanning perimeter...",
            font=("Consolas", 15), fill="#94A3B8"
        )

        self.root.withdraw()
        self.root.after(16, self._process_queue)
        self.root.mainloop()

    def _process_queue(self):
        try:
            latest_action = None
            latest_data = None
            while not self.cmd_queue.empty():
                latest_action, latest_data = self.cmd_queue.get_nowait()

            if latest_action == "SHOW":
                self.canvas.itemconfig(
                    self.detail_text,
                    text=f"Threat Vector: {latest_data}\n[Eye-Gaze Alignment Confirmed | Screen Mask 100%]"
                )
                if not self.is_visible:
                    self.root.deiconify()
                    self.root.lift()
                    self.root.attributes('-topmost', True)
                    self.is_visible = True
            elif latest_action == "HIDE":
                if self.is_visible:
                    self.root.withdraw()
                    self.is_visible = False
        except Exception as e:
            print(f"[HUD Error]: {e}")
        finally:
            if self.root:
                self.root.after(16, self._process_queue)

    def trigger_show(self, reason: str):
        self.cmd_queue.put(("SHOW", reason))

    def trigger_hide(self):
        self.cmd_queue.put(("HIDE", None))