"""Pipeline parameter defaults matching the LEAP PDF specifications.

These constants are used by the segmentation and Blender stages to ensure the
pipeline behaves exactly as described in the reference document.
"""

# Segmentation parameters
GRID_SIZE = 240          # Resolution of the XY grid for column map
DET_CUT = 0.5            # Detection cut‑off ratio (default in fast_pipeline)
GUM_CUT = 0.3            # Gum line cut‑off ratio
MIN_CELLS = 8            # Minimum number of cells per tooth blob

# Blender export parameters
SHELL_THICKNESS_MM = 0.75
OFFSET_MM = 0.1
UNDERCUT_ANGLE_DEG = 45.0
GINGIVA_MARGIN_MM = 1.0
