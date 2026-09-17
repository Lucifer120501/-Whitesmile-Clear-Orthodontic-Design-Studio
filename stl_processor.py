import sys
import os
import json
import struct

def parse_stl(file_path):
    """
    Parses an STL file (ASCII or Binary) to check if it's readable,
    and extracts metadata such as file size, estimated arch type, and triangle count.
    """
    if not os.path.exists(file_path):
        return {
            "valid": False,
            "error": f"File {file_path} does not exist",
            "file_size": 0,
            "arch_guess": "unspecified",
            "triangle_count": 0,
            "format": "Unknown"
        }
    
    file_size = os.path.getsize(file_path)
    filename = os.path.basename(file_path).lower()
    
    # Guess arch from file name
    arch = "unspecified"
    if any(k in filename for k in ["upper", "maxillary", "u_", "sup"]):
        arch = "upper"
    elif any(k in filename for k in ["lower", "mandibular", "l_", "inf"]):
        arch = "lower"
    
    # Try reading as ASCII first
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            first_line = f.readline().strip()
            if first_line.startswith('solid'):
                # It is likely ASCII STL
                # Let's count facets
                facet_count = 0
                f.seek(0)
                for line in f:
                    if 'facet normal' in line:
                        facet_count += 1
                return {
                    "valid": True,
                    "format": "ASCII",
                    "file_size": file_size,
                    "arch_guess": arch,
                    "triangle_count": facet_count,
                    "error": None
                }
    except Exception:
        pass
        
    # Read as binary STL
    try:
        with open(file_path, 'rb') as f:
            header = f.read(80)
            if len(header) < 80:
                return {
                    "valid": False,
                    "error": "File is too small to be a valid binary STL (less than 80 bytes header)",
                    "file_size": file_size,
                    "arch_guess": arch,
                    "triangle_count": 0,
                    "format": "Binary"
                }
            
            # Next 4 bytes is number of triangles
            count_bytes = f.read(4)
            if len(count_bytes) < 4:
                return {
                    "valid": False,
                    "error": "Missing triangle count field in binary STL",
                    "file_size": file_size,
                    "arch_guess": arch,
                    "triangle_count": 0,
                    "format": "Binary"
                }
            
            num_triangles = struct.unpack('<I', count_bytes)[0]
            
            # Verify file size matches expected size for num_triangles
            # Each triangle is 50 bytes: 12 bytes normal, 36 bytes vertices, 2 bytes attribute
            expected_size = 84 + num_triangles * 50
            
            # Allow minor slack for optional footer or custom metadata
            if file_size < expected_size:
                return {
                    "valid": False,
                    "error": f"Truncated binary STL. Expected at least {expected_size} bytes for {num_triangles} triangles, but got {file_size} bytes.",
                    "file_size": file_size,
                    "arch_guess": arch,
                    "triangle_count": num_triangles,
                    "format": "Binary"
                }
                
            return {
                "valid": True,
                "format": "Binary",
                "file_size": file_size,
                "arch_guess": arch,
                "triangle_count": num_triangles,
                "error": None
            }
    except Exception as e:
        return {
            "valid": False,
            "error": f"Failed to parse binary STL: {str(e)}",
            "file_size": file_size,
            "arch_guess": arch,
            "triangle_count": 0,
            "format": "Binary"
        }

def validate_design_json(json_data):
    """
    Validates AI-generated JSON against schema and orthodontic retainer business rules.
    """
    validation_errors = []
    
    # Check top-level keys
    required_keys = ["design_parameters", "manufacturing_instructions", "warnings"]
    for key in required_keys:
        if key not in json_data:
            validation_errors.append(f"Missing required top-level key: '{key}'")
            
    if validation_errors:
        return {"valid": False, "errors": validation_errors}
        
    # Check design_parameters sub-keys
    dp = json_data.get("design_parameters", {})
    if not isinstance(dp, dict):
        validation_errors.append("'design_parameters' must be an object")
        return {"valid": False, "errors": validation_errors}
        
    required_dp_keys = [
        "appliance", "arch", "material", "thickness_mm", 
        "coverage", "trim_line", "relief_areas", "special_notes"
    ]
    for key in required_dp_keys:
        if key not in dp:
            validation_errors.append(f"Missing required design parameter: '{key}'")
            
    # Check arrays
    if not isinstance(json_data.get("manufacturing_instructions", []), list):
        validation_errors.append("'manufacturing_instructions' must be an array")
    if not isinstance(json_data.get("warnings", []), list):
        validation_errors.append("'warnings' must be an array")
    if not isinstance(dp.get("relief_areas", []), list):
        validation_errors.append("'relief_areas' must be an array")
        
    if validation_errors:
        return {"valid": False, "errors": validation_errors}
        
    # Validate business rules
    appliance = str(dp.get("appliance", "")).strip().lower()
    material = str(dp.get("material", "")).strip().lower()
    try:
        thickness_mm = float(dp.get("thickness_mm", 0))
    except (ValueError, TypeError):
        validation_errors.append("'thickness_mm' must be a numeric value")
        thickness_mm = 0
        
    if appliance not in ["essix", "hawley", "other"]:
        validation_errors.append(f"Invalid appliance: '{dp.get('appliance')}'. Must be Essix, Hawley, or Other.")
        
    # Essix Rules
    if appliance == "essix":
        # Material check (PETG or similar thermoforming)
        allowed_essix_materials = ["petg", "thermoform", "plastic", "copolyester", "polycarbonate", "clear sheet"]
        if not any(m in material for m in allowed_essix_materials):
            validation_errors.append(
                f"Business Rule Violation (Essix Material): Material '{dp.get('material')}' is invalid. "
                "Must be PETG or standard thermoforming plastic sheet."
            )
        # Thickness check: 0.75mm / 1.0mm / 1.5mm
        valid_thicknesses = [0.75, 1.0, 1.5]
        is_valid_thickness = any(abs(thickness_mm - vt) < 0.05 for vt in valid_thicknesses)
        if not is_valid_thickness:
            validation_errors.append(
                f"Business Rule Violation (Essix Thickness): Thickness '{thickness_mm}mm' is invalid. "
                "Essix standard thicknesses are 0.75mm, 1.0mm, or 1.5mm."
            )
            
    # Hawley Rules
    elif appliance == "hawley":
        # Material check (Acrylic / base plate)
        if "acrylic" not in material and "pmma" not in material:
            validation_errors.append(
                f"Business Rule Violation (Hawley Material): Material '{dp.get('material')}' is invalid. "
                "Hawley retainers require an acrylic baseplate."
            )
        # Check stainless steel bow reference
        found_bow_reference = False
        all_text = material + " " + " ".join(str(i).lower() for i in json_data.get("manufacturing_instructions", []))
        if "steel" in all_text or "bow" in all_text or "wire" in all_text or "0.7" in all_text:
            found_bow_reference = True
        if not found_bow_reference:
            validation_errors.append(
                "Business Rule Violation (Hawley Hardware): Missing stainless steel labial bow reference in material or fabrication instructions."
            )
            
    return {
        "valid": len(validation_errors) == 0,
        "errors": validation_errors
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Invalid command arguments. Use 'analyze <file_path>' or 'validate <json_path_or_string>'"}))
        sys.exit(1)
        
    cmd = sys.argv[1]
    arg = sys.argv[2]
    
    if cmd == "analyze":
        result = parse_stl(arg)
        print(json.dumps(result))
    elif cmd == "validate":
        # Try to parse string directly, or load as file if it exists
        try:
            if os.path.exists(arg):
                with open(arg, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            else:
                data = json.loads(arg)
            validation = validate_design_json(data)
            print(json.dumps(validation))
        except Exception as e:
            print(json.dumps({"valid": False, "errors": [f"Failed to parse JSON input for validation: {str(e)}"]}))
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
