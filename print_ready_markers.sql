-- SQL schema for dental case print-ready markers
-- Designed for storing cases, STL scans, audit recommendations, and marker output

CREATE TABLE IF NOT EXISTS cases (
  case_id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name TEXT NOT NULL,
  patient_id TEXT,
  appliance_type TEXT NOT NULL,
  arch TEXT NOT NULL,
  selected_material TEXT NOT NULL,
  shell_thickness_mm REAL NOT NULL,
  trim_line_type TEXT NOT NULL,
  trim_scallop_offset_mm REAL NOT NULL,
  print_ready BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stl_files (
  stl_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  scan_type TEXT,
  file_size_bytes INTEGER,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS audit_markers (
  marker_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  tooth_id INTEGER,
  marker_label TEXT NOT NULL,
  marker_type TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#EF4444',
  x REAL,
  y REAL,
  z REAL,
  recommendation_text TEXT,
  print_position_x_mm REAL,
  print_position_y_mm REAL,
  print_position_z_mm REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases(case_id)
);

CREATE TABLE IF NOT EXISTS print_instructions (
  instruction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  printer_profile TEXT NOT NULL,
  sheet_width_mm REAL DEFAULT 210,
  sheet_height_mm REAL DEFAULT 297,
  margin_left_mm REAL DEFAULT 10,
  margin_right_mm REAL DEFAULT 10,
  margin_top_mm REAL DEFAULT 10,
  margin_bottom_mm REAL DEFAULT 10,
  marker_scale REAL DEFAULT 1.0,
  marker_label_font TEXT DEFAULT 'Arial',
  marker_label_size_pt INTEGER DEFAULT 8,
  include_legend BOOLEAN NOT NULL DEFAULT 1,
  notes TEXT,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases(case_id)
);

CREATE VIEW IF NOT EXISTS print_ready_markers AS
SELECT
  c.case_id,
  c.patient_name,
  c.patient_id,
  c.appliance_type,
  c.arch,
  c.selected_material,
  c.shell_thickness_mm,
  c.trim_line_type,
  c.trim_scallop_offset_mm,
  p.printer_profile,
  p.sheet_width_mm,
  p.sheet_height_mm,
  p.margin_left_mm,
  p.margin_top_mm,
  m.marker_id,
  m.tooth_id,
  m.marker_label,
  m.marker_type,
  m.color,
  COALESCE(m.print_position_x_mm, m.x) AS print_pos_x_mm,
  COALESCE(m.print_position_y_mm, m.y) AS print_pos_y_mm,
  COALESCE(m.print_position_z_mm, m.z) AS print_pos_z_mm,
  m.recommendation_text
FROM cases AS c
LEFT JOIN print_instructions AS p ON p.case_id = c.case_id
LEFT JOIN audit_markers AS m ON m.case_id = c.case_id
WHERE c.print_ready = 1;

-- Example row insertion for a print-ready case with markers
INSERT INTO cases (patient_name, patient_id, appliance_type, arch, selected_material, shell_thickness_mm, trim_line_type, trim_scallop_offset_mm, print_ready)
VALUES ('Erina Tanaka', 'ERINA-001', 'Essix Retainer', 'Both', 'PETG 1.0mm Thermoforming Sheet', 1.0, 'scalloped', 1.5, 1);

INSERT INTO stl_files (case_id, file_name, file_url, scan_type, file_size_bytes)
VALUES (1, 'upper_scan.stl', '/uploads/upper_scan.stl', 'upper', 2150000);

INSERT INTO audit_markers (case_id, tooth_id, marker_label, marker_type, color, x, y, z, print_position_x_mm, print_position_y_mm, print_position_z_mm, recommendation_text)
VALUES
  (1, 12, 'Relief', 'relief_area', '#F97316', 12.1, 8.3, 4.2, 12.1, 8.3, 4.2, 'Add 0.5mm relief above tooth 12 for sulcus clearance'),
  (1, 21, 'Attachment', 'attachment_area', '#D97706', 10.5, 7.9, 4.1, 10.5, 7.9, 4.1, 'Place beveled active attachment on tooth 21');

INSERT INTO print_instructions (case_id, printer_profile, sheet_width_mm, sheet_height_mm, marker_scale, notes)
VALUES (1, 'Standard U.S. Letter', 216.0, 279.0, 1.0, 'Print marker overlay using the red and orange annotation guides.');
