import queue
import tkinter as tk
import platform
import ctypes

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020

class ThreadSafePrivacyHUD:
    def __init__(self):
        self.cmd_queue = queue.Queue()
        self.root = None
        self.canvas = None
        self.title_text = None
        self.detail_text = None
        self.badge_rect = None
        self.is_visible = False
        self._hwnd = None

    def _apply_win32_clickthrough(self):
        """Forces all mouse clicks and keystrokes to pass directly through to background apps."""
        if platform.system() == "Windows" and self.root:
            try:
                # Update window to ensure HWND exists
                self.root.update_idletasks()
                hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
                if not hwnd:
                    hwnd = self.root.winfo_id()
                self._hwnd = hwnd
                style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED | WS_EX_TRANSPARENT)
            except Exception as err:
                print(f"[HUD Clickthrough Warn]: {err}")

    def start_gui(self):
        self.root = tk.Tk()
        self.root.title("Blackout Privacy Shield")
        
        # Make fullscreen borderless
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-alpha', 0.88)
        self.root.attributes('-topmost', True)
        self.root.configure(bg='#020617')

        width = self.root.winfo_screenwidth()
        height = self.root.winfo_screenheight()

        self.canvas = tk.Canvas(
            self.root,
            width=width,
            height=height,
            bg='#020617',
            highlightthickness=0
        )
        self.canvas.pack(fill='both', expand=True)

        # Micro-louvers vertical lines
        for x in range(0, width, 4):
            self.canvas.create_line(x, 0, x, height, fill="#0F172A", width=1)

        # Compact Bottom-Right Tactical Badge (Small & Non-intrusive)
        bx2 = width - 20
        by2 = height - 25
        bx1 = bx2 - 320
        by1 = by2 - 50

        self.badge_rect = self.canvas.create_rectangle(
            bx1, by1, bx2, by2,
            fill="#09090B",
            outline="#FACC15",
            width=1.5
        )

        self.title_text = self.canvas.create_text(
            bx1 + 14, by1 + 15,
            text="🛡️ BLACKOUT PRIVACY ENGAGED",
            font=("Consolas", 9, "bold"),
            fill="#FACC15",
            anchor="w"
        )

        self.detail_text = self.canvas.create_text(
            bx1 + 14, by1 + 33,
            text="Securing workspace...",
            font=("Consolas", 8),
            fill="#94A3B8",
            anchor="w"
        )

        # Start hidden using alpha 0 instead of withdraw (prevents HWND drops)
        self.root.attributes('-alpha', 0.0)
        self.root.update()

        # Apply click-through hook
        self._apply_win32_clickthrough()

        self.root.after(16, self._process_queue)
        self.root.mainloop()

    def _process_queue(self):
        try:
            latest_action = None
            latest_data = None

            while not self.cmd_queue.empty():
                latest_action, latest_data = self.cmd_queue.get_nowait()

            if latest_action == "SHOW":
                compact_reason = str(latest_data)
                if len(compact_reason) > 38:
                    compact_reason = compact_reason[:35] + "..."

                self.canvas.itemconfig(
                    self.detail_text,
                    text=f"Threat: {compact_reason}"
                )

                if not self.is_visible:
                    # Make visible with target opacity and re-apply topmost
                    self.root.attributes('-alpha', 0.88)
                    self.root.attributes('-topmost', True)
                    self._apply_win32_clickthrough()
                    self.is_visible = True
                    print(f"[HUD] Privacy Mask Rendered (Click-Through Enabled) -> {compact_reason}")

            elif latest_action == "HIDE":
                if self.is_visible:
                    self.root.attributes('-alpha', 0.0)
                    self.is_visible = False
                    print("[HUD] Workspace Restored (Hidden)")

        except Exception as e:
            print(f"[HUD Error]: {e}")
        finally:
            if self.root:
                self.root.after(16, self._process_queue)

    def trigger_show(self, reason: str):
        self.cmd_queue.put(("SHOW", reason))

    def trigger_hide(self):
        self.cmd_queue.put(("HIDE", None))