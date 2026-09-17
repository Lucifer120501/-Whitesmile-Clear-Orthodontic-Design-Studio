"""
Simple interactive UI for creating / editing treatment plans.

Built with Tkinter (standard library) so no extra dependencies are needed.
Lets the user:
- Load existing STL files (auto-detect tooth numbers)
- Set per-tooth target movements (tx, ty, tz, rx, ry, rz)
- Configure number of stages and aligner parameters
- Add attachments to teeth
- Save / load treatment plan JSON
- Launch the pipeline
"""

from __future__ import annotations

import json
import os
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from pathlib import Path
from typing import Optional

# Import pipeline parameters for consistency
try:
    from config.pipeline_params import SHELL_THICKNESS_MM, OFFSET_MM, UNDERCUT_ANGLE_DEG, GINGIVA_MARGIN_MM
except ImportError:
    SHELL_THICKNESS_MM = 0.75
    OFFSET_MM = 0.1
    UNDERCUT_ANGLE_DEG = 45.0
    GINGIVA_MARGIN_MM = 1.0

# We import the data models for plan creation
from config.treatment_plan import TreatmentPlan, ToothMove, Stage, plan_to_json, plan_from_json


# ===================================================================
#  Plan Editor Application
# ===================================================================

class PlanEditorApp:
    """Tkinter GUI for treatment plan creation."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Clear Aligner Treatment Plan Editor")
        self.root.geometry("1100x750")

        self.plan = TreatmentPlan()
        self.stl_files: dict[int, str] = {}  # tooth_number -> path
        self.gingiva_path: str = ""
        self.plan_path: Optional[str] = None

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------------------------------------------------------------
    #  UI Construction
    # ---------------------------------------------------------------

    def _build_ui(self):
        # Menu bar
        menubar = tk.Menu(self.root)
        self.root.config(menu=menubar)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="New Plan", command=self._new_plan)
        file_menu.add_command(label="Open Plan...", command=self._open_plan)
        file_menu.add_command(label="Save Plan", command=self._save_plan)
        file_menu.add_command(label="Save Plan As...", command=self._save_plan_as)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self._on_close)
        menubar.add_cascade(label="File", menu=file_menu)

        run_menu = tk.Menu(menubar, tearoff=0)
        run_menu.add_command(label="Run Pipeline...", command=self._run_pipeline)
        menubar.add_cascade(label="Pipeline", menu=run_menu)

        # Main layout: left (config) + right (tooth table)
        main_pane = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main_pane.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # --- Left panel: Global settings ---
        left_frame = ttk.Frame(main_pane, width=400)
        main_pane.add(left_frame, weight=1)

        row = 0

        # STL directory
        ttk.Label(left_frame, text="STL Directory:").grid(row=row, column=0, sticky="w", pady=2)
        self.stl_dir_var = tk.StringVar()
        ttk.Entry(left_frame, textvariable=self.stl_dir_var, width=40).grid(row=row, column=1, padx=5)
        ttk.Button(left_frame, text="Browse...", command=self._browse_stl_dir).grid(row=row, column=2)
        row += 1

        # Output directory
        ttk.Label(left_frame, text="Output Directory:").grid(row=row, column=0, sticky="w", pady=2)
        self.out_dir_var = tk.StringVar(value="aligner_output")
        ttk.Entry(left_frame, textvariable=self.out_dir_var, width=40).grid(row=row, column=1, padx=5)
        ttk.Button(left_frame, text="Browse...", command=self._browse_out_dir).grid(row=row, column=2)
        row += 1

        # Case name
        ttk.Label(left_frame, text="Case Name:").grid(row=row, column=0, sticky="w", pady=2)
        self.case_name_var = tk.StringVar(value="case_001")
        ttk.Entry(left_frame, textvariable=self.case_name_var, width=40).grid(row=row, column=1, padx=5)
        row += 1

        # Patient ID
        ttk.Label(left_frame, text="Patient ID:").grid(row=row, column=0, sticky="w", pady=2)
        self.patient_id_var = tk.StringVar()
        ttk.Entry(left_frame, textvariable=self.patient_id_var, width=40).grid(row=row, column=1, padx=5)
        row += 1

        # Separator
        ttk.Separator(left_frame, orient="horizontal").grid(row=row, column=0, columnspan=3, sticky="ew", pady=8)
        row += 1

        # Number of stages
        ttk.Label(left_frame, text="Number of Stages:").grid(row=row, column=0, sticky="w", pady=2)
        self.num_stages_var = tk.IntVar(value=20)
        ttk.Spinbox(left_frame, from_=1, to_=99, textvariable=self.num_stages_var, width=10).grid(row=row, column=1, sticky="w", padx=5)
        row += 1

        # Shell thickness
        ttk.Label(left_frame, text="Shell Thickness (mm):").grid(row=row, column=0, sticky="w", pady=2)
        self.shell_thick_var = tk.DoubleVar(value=SHELL_THICKNESS_MM)
        ttk.Entry(left_frame, textvariable=self.shell_thick_var, width=10).grid(row=row, column=1, sticky="w", padx=5)
        row += 1

        # Offset (gap)
        ttk.Label(left_frame, text="Offset / Gap (mm):").grid(row=row, column=0, sticky="w", pady=2)
        self.offset_var = tk.DoubleVar(value=OFFSET_MM)
        ttk.Entry(left_frame, textvariable=self.offset_var, width=10).grid(row=row, column=1, sticky="w", padx=5)
        row += 1

        # Undercut angle
        ttk.Label(left_frame, text="Undercut Block Angle (deg):").grid(row=row, column=0, sticky="w", pady=2)
        self.undercut_var = tk.DoubleVar(value=UNDERCUT_ANGLE_DEG)
        ttk.Entry(left_frame, textvariable=self.undercut_var, width=10).grid(row=row, column=1, sticky="w", padx=5)
        row += 1

        # Gingiva margin
        ttk.Label(left_frame, text="Gingiva Margin (mm):").grid(row=row, column=0, sticky="w", pady=2)
        self.margin_var = tk.DoubleVar(value=GINGIVA_MARGIN_MM)
        ttk.Entry(left_frame, textvariable=self.margin_var, width=10).grid(row=row, column=1, sticky="w", padx=5)
        row += 1

        # Attachments toggle
        self.attach_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(left_frame, text="Enable Attachments", variable=self.attach_var).grid(row=row, column=0, columnspan=2, sticky="w", pady=2)
        row += 1

        # Gingiva STL path
        ttk.Separator(left_frame, orient="horizontal").grid(row=row, column=0, columnspan=3, sticky="ew", pady=8)
        row += 1
        ttk.Label(left_frame, text="Gingiva STL:").grid(row=row, column=0, sticky="w", pady=2)
        self.gingiva_var = tk.StringVar()
        ttk.Entry(left_frame, textvariable=self.gingiva_var, width=40).grid(row=row, column=1, padx=5)
        ttk.Button(left_frame, text="Browse...", command=self._browse_gingiva).grid(row=row, column=2)
        row += 1

        # Discover teeth button
        ttk.Button(left_frame, text="Discover Teeth from STL Dir", command=self._discover_teeth).grid(row=row, column=0, columnspan=3, pady=10)
        row += 1

        # Detected teeth label
        ttk.Label(left_frame, text="Detected Teeth:").grid(row=row, column=0, sticky="nw", pady=2)
        self.teeth_list_var = tk.StringVar(value="(none)")
        ttk.Label(left_frame, textvariable=self.teeth_list_var, wraplength=280).grid(row=row, column=1, columnspan=2, sticky="w", pady=2)

        # --- Right panel: Tooth movement table ---
        right_frame = ttk.Frame(main_pane)
        main_pane.add(right_frame, weight=2)

        ttk.Label(right_frame, text="Per-Tooth Movement Targets", font=("", 11, "bold")).pack(anchor="nw", pady=(0, 5))

        # Treeview
        columns = ("tooth", "tx", "ty", "tz", "rx", "ry", "rz", "attach")
        self.tree = ttk.Treeview(right_frame, columns=columns, show="headings", height=18)
        self.tree.heading("tooth", text="Tooth #")
        self.tree.heading("tx", text="TX (mm)")
        self.tree.heading("ty", text="TY (mm)")
        self.tree.heading("tz", text="TZ (mm)")
        self.tree.heading("rx", text="RX (°)")
        self.tree.heading("ry", text="RY (°)")
        self.tree.heading("rz", text="RZ (°)")
        self.tree.heading("attach", text="Attachment")

        for col in columns:
            self.tree.column(col, width=80, anchor="center")
        self.tree.column("tooth", width=70)
        self.tree.column("attach", width=120)

        scrollbar = ttk.Scrollbar(right_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Bind double-click to edit
        self.tree.bind("<Double-1>", self._edit_cell)

    # ---------------------------------------------------------------
    #  Actions
    # ---------------------------------------------------------------

    def _browse_stl_dir(self):
        d = filedialog.askdirectory(title="Select Segmented STL Directory")
        if d:
            self.stl_dir_var.set(d)
            self._discover_teeth()

    def _browse_out_dir(self):
        d = filedialog.askdirectory(title="Select Output Directory")
        if d:
            self.out_dir_var.set(d)

    def _browse_gingiva(self):
        f = filedialog.askopenfilename(title="Select Gingiva STL", filetypes=[("STL files", "*.stl")])
        if f:
            self.gingiva_var.set(f)
            self.gingiva_path = f

    def _discover_teeth(self):
        """Scan the STL directory and populate the tooth table."""
        stl_dir = self.stl_dir_var.get()
        if not stl_dir or not os.path.isdir(stl_dir):
            messagebox.showwarning("Warning", "STL directory is not valid.")
            return

        self.stl_files.clear()
        for fname in sorted(os.listdir(stl_dir)):
            if fname.lower().startswith("tooth_") and fname.lower().endswith(".stl"):
                try:
                    tn = int(fname.split("_")[1].split(".")[0])
                    self.stl_files[tn] = os.path.join(stl_dir, fname)
                except (IndexError, ValueError):
                    pass
            elif fname.lower() == "gingiva.stl":
                self.gingiva_path = os.path.join(stl_dir, fname)
                self.gingiva_var.set(self.gingiva_path)

        if not self.stl_files:
            messagebox.showinfo("Info", "No tooth_XX.stl files found in directory.")
            return

        self.teeth_list_var.set(", ".join(str(t) for t in sorted(self.stl_files.keys())))
        self._populate_tree()
        messagebox.showinfo("Discovered", f"Found {len(self.stl_files)} teeth: {', '.join(str(t) for t in sorted(self.stl_files.keys()))}")

    def _populate_tree(self):
        """Fill the treeview with current tooth data."""
        for item in self.tree.get_children():
            self.tree.delete(item)

        for tn in sorted(self.stl_files.keys()):
            move = self.plan.movements.get(tn, ToothMove(tooth_number=tn))
            attach = move.attachment_type or ""
            self.tree.insert(
                "", tk.END,
                values=(tn, f"{move.tx:.2f}", f"{move.ty:.2f}", f"{move.tz:.2f}",
                        f"{move.rx:.1f}", f"{move.ry:.1f}", f"{move.rz:.1f}", attach),
            )

    def _edit_cell(self, event):
        """Open a small popup to edit the selected tooth's movement."""
        sel = self.tree.selection()
        if not sel:
            return
        item = sel[0]
        values = self.tree.item(item, "values")
        if not values:
            return

        tn = int(values[0])
        # Create popup
        popup = tk.Toplevel(self.root)
        popup.title(f"Tooth {tn} Movement")
        popup.geometry("350x350")
        popup.transient(self.root)
        popup.grab_set()

        fields = [
            ("TX (mm)", "tx"), ("TY (mm)", "ty"), ("TZ (mm)", "tz"),
            ("RX (deg)", "rx"), ("RY (deg)", "ry"), ("RZ (deg)", "rz"),
        ]
        entries = {}
        current = self.plan.movements.get(tn, ToothMove(tooth_number=tn))

        for i, (label, key) in enumerate(fields):
            ttk.Label(popup, text=label).grid(row=i, column=0, sticky="w", padx=10, pady=3)
            var = tk.StringVar(value=str(getattr(current, key)))
            entries[key] = var
            ttk.Entry(popup, textvariable=var, width=12).grid(row=i, column=1, padx=5, pady=3)

        # Attachment type
        ttk.Label(popup, text="Attachment Type:").grid(row=len(fields), column=0, sticky="w", padx=10, pady=3)
        attach_var = tk.StringVar(value=current.attachment_type or "")
        attach_combo = ttk.Combobox(popup, textvariable=attach_var, values=["", "ellipsoid", "beveled"], width=12)
        attach_combo.grid(row=len(fields), column=1, padx=5, pady=3)

        def save():
            try:
                move = ToothMove(
                    tooth_number=tn,
                    tx=float(entries["tx"].get() or 0),
                    ty=float(entries["ty"].get() or 0),
                    tz=float(entries["tz"].get() or 0),
                    rx=float(entries["rx"].get() or 0),
                    ry=float(entries["ry"].get() or 0),
                    rz=float(entries["rz"].get() or 0),
                    attachment_type=attach_var.get() or None,
                )
                self.plan.movements[tn] = move
                self._populate_tree()
                popup.destroy()
            except ValueError as e:
                messagebox.showerror("Invalid input", str(e))

        ttk.Button(popup, text="Save", command=save).grid(row=len(fields) + 1, column=0, columnspan=2, pady=15)

    # ---------------------------------------------------------------
    #  File I/O
    # ---------------------------------------------------------------

    def _gather_plan_from_ui(self) -> TreatmentPlan:
        """Build a TreatmentPlan from current UI state."""
        plan = TreatmentPlan(
            patient_id=self.patient_id_var.get(),
            case_name=self.case_name_var.get(),
            tooth_numbers=sorted(self.stl_files.keys()),
            num_stages=self.num_stages_var.get(),
            shell_thickness_mm=self.shell_thick_var.get(),
            offset_mm=self.offset_var.get(),
            undercut_block_angle=self.undercut_var.get(),
            gingiva_margin_mm=self.margin_var.get(),
            attachments_enabled=self.attach_var.get(),
            stl_dir=self.stl_dir_var.get(),
            output_dir=os.path.join(self.out_dir_var.get(), self.case_name_var.get()),
            movements=self.plan.movements,
        )
        return plan

    def _new_plan(self):
        self.plan = TreatmentPlan()
        self.plan_path = None
        self._populate_tree()

    def _open_plan(self):
        f = filedialog.askopenfilename(
            title="Open Treatment Plan",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not f:
            return
        with open(f, "r") as fh:
            self.plan = plan_from_json(fh.read())
        self.plan_path = f
        # Sync UI
        self.stl_dir_var.set(self.plan.stl_dir)
        self.out_dir_var.set(os.path.dirname(self.plan.output_dir) if self.plan.output_dir else "")
        self.case_name_var.set(self.plan.case_name)
        self.patient_id_var.set(self.plan.patient_id)
        self.num_stages_var.set(self.plan.num_stages)
        self.shell_thick_var.set(self.plan.shell_thickness_mm)
        self.offset_var.set(self.plan.offset_mm)
        self.undercut_var.set(self.plan.undercut_block_angle)
        self.margin_var.set(self.plan.gingiva_margin_mm)
        self.attach_var.set(self.plan.attachments_enabled)
        self._discover_teeth()

    def _save_plan(self):
        if self.plan_path:
            self._write_plan(self.plan_path)
        else:
            self._save_plan_as()

    def _save_plan_as(self):
        f = filedialog.asksaveasfilename(
            title="Save Treatment Plan",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if f:
            self.plan_path = f
            self._write_plan(f)

    def _write_plan(self, path: str):
        plan = self._gather_plan_from_ui()
        with open(path, "w") as f:
            f.write(plan_to_json(plan))
        messagebox.showinfo("Saved", f"Plan saved to {path}")

    # ---------------------------------------------------------------
    #  Run pipeline
    # ---------------------------------------------------------------

    def _run_pipeline(self):
        """Validate the plan and launch the pipeline CLI."""
        plan = self._gather_plan_from_ui()
        if not plan.tooth_numbers:
            messagebox.showwarning("Warning", "No teeth configured. Discover STLs first.")
            return
        if not plan.movements:
            messagebox.showwarning("Warning", "No tooth movements defined. Set movements first.")
            return
        if not plan.stl_dir or not os.path.isdir(plan.stl_dir):
            messagebox.showwarning("Warning", "STL directory is not valid.")
            return

        # Save plan temporarily and launch
        tmp_plan = os.path.join(
            plan.output_dir or ".",
            f"treatment_plan_{plan.case_name}.json",
        )
        os.makedirs(os.path.dirname(tmp_plan), exist_ok=True)
        with open(tmp_plan, "w") as f:
            f.write(plan_to_json(plan))

        # Ask whether to run
        if not messagebox.askyesno("Run Pipeline", f"Launch pipeline with {plan.num_stages} stages?\n\nPlan saved to:\n{tmp_plan}"):
            return

        self.root.destroy()

        # Import and run
        from run_pipeline import run_pipeline
        run_pipeline(
            treatment_plan=tmp_plan,
            stl_dir=plan.stl_dir,
            gingiva_stl=self.gingiva_path,
            output_dir=plan.output_dir,
            num_stages=plan.num_stages,
            shell_thickness=plan.shell_thickness_mm,
            offset_mm=plan.offset_mm,
            undercut_angle=plan.undercut_block_angle,
            gingiva_margin=plan.gingiva_margin_mm,
            attachments_enabled=plan.attachments_enabled,
            easing="linear",
            export_individual=True,
            export_aligner=True,
            verbose=True,
            skip_confirmation=True,
        )

    def _on_close(self):
        if messagebox.askokcancel("Quit", "Exit Plan Editor?"):
            self.root.destroy()

    def run(self):
        self.root.mainloop()


# ===================================================================
#  Entry point
# ===================================================================

def main():
    app = PlanEditorApp()
    app.run()


if __name__ == "__main__":
    main()
