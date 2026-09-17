import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { 
  RotateCcw, 
  Layers, 
  Eye, 
  EyeOff, 
  Loader2, 
  Sparkles, 
  FileCode,
  MousePointer,
  X
} from "lucide-react";

// Types matching the dental CAD schema
interface Tooth {
  id: number;
  name: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  label: string;
  arch: "upper" | "lower";
}

interface ThreeDViewerProps {
  activeArchTab: "upper" | "lower";
  teeth: Tooth[];
  selectedReliefTeeth: number[];
  selectedAttachmentTeeth: number[];
  attachmentShape: string;
  attachmentWidth: number;
  attachmentHeight: number;
  attachmentDepth: number;
  baseExtrusionHeight: number;
  orthoBaseTemplate: "horseshoe" | "tweed_abo" | "threeshape_bar";
  patientIdLabel: string;
  labelType: "embossed" | "engraved" | "none";
  isHollowModel: boolean;
  hollowWallThickness: number;
  addDrainHoles: boolean;
  articulatorNotches: boolean;
  trimScallopOffset: number;
  trimLineType: "scalloped" | "straight" | "beveled";
  files?: Array<{ name: string; url?: string; size: number }>;
  onToggleToothAttachment?: (toothId: number) => void;
  onToggleToothRelief?: (toothId: number) => void;
  onCalibrateTrimPoint?: (point: THREE.Vector3) => void;
  cadMode: "relief" | "attachments";
  individualTrimOffsets?: Record<number, number>;
  compromisedTeeth?: number[];
  sculptMode?: "none" | "draw" | "erase";
  brushSize?: number;
  sculptedPoints?: Array<{ x: number; y: number; z: number; size: number }>;
  onAddSculptedPoint?: (pt: { x: number; y: number; z: number; size: number }) => void;
  onRemoveSculptedPoint?: (index: number) => void;
  auditResult?: { safe: boolean; flaws: string[]; recommendations: string[] };
  optimizationReasoning?: string;
  optimizationValidation?: string;
}

// STL Parser Utility supporting both ASCII and Binary STL formats
function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const isBinary = (buf: ArrayBuffer): boolean => {
    if (buf.byteLength < 84) return false;
    const reader = new DataView(buf);
    const numTriangles = reader.getUint32(80, true);
    const expectedSize = 84 + numTriangles * 50;
    return buf.byteLength === expectedSize || buf.byteLength === expectedSize + 2 || (buf.byteLength > expectedSize && expectedSize > 84);
  };

  const parseBinary = (buf: ArrayBuffer): THREE.BufferGeometry => {
    const reader = new DataView(buf);
    const numTriangles = reader.getUint32(80, true);
    
    const positions = new Float32Array(numTriangles * 9);
    const normals = new Float32Array(numTriangles * 9);
    
    let offset = 84;
    for (let i = 0; i < numTriangles; i++) {
      if (offset + 50 > buf.byteLength) break;
      
      // Face Normal
      const nx = reader.getFloat32(offset, true);
      const ny = reader.getFloat32(offset + 4, true);
      const nz = reader.getFloat32(offset + 8, true);
      offset += 12;
      
      // Vertex 1
      const v1x = reader.getFloat32(offset, true);
      const v1y = reader.getFloat32(offset + 4, true);
      const v1z = reader.getFloat32(offset + 8, true);
      offset += 12;
      
      // Vertex 2
      const v2x = reader.getFloat32(offset, true);
      const v2y = reader.getFloat32(offset + 4, true);
      const v2z = reader.getFloat32(offset + 8, true);
      offset += 12;
      
      // Vertex 3
      const v3x = reader.getFloat32(offset, true);
      const v3y = reader.getFloat32(offset + 4, true);
      const v3z = reader.getFloat32(offset + 8, true);
      offset += 12;
      
      // Attribute byte count (2 bytes)
      offset += 2;
      
      const idx = i * 9;
      
      // Vertex 1
      positions[idx] = v1x;
      positions[idx + 1] = v1y;
      positions[idx + 2] = v1z;
      
      // Vertex 2
      positions[idx + 3] = v2x;
      positions[idx + 4] = v2y;
      positions[idx + 5] = v2z;
      
      // Vertex 3
      positions[idx + 6] = v3x;
      positions[idx + 7] = v3y;
      positions[idx + 8] = v3z;
      
      // Normals
      for (let j = 0; j < 3; j++) {
        const nidx = idx + j * 3;
        normals[nidx] = nx;
        normals[nidx + 1] = ny;
        normals[nidx + 2] = nz;
      }
    }
    
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (numTriangles > 0 && normals[0] !== 0 && normals[1] !== 0 && normals[2] !== 0) {
      geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    } else {
      geom.computeVertexNormals();
    }
    return geom;
  };

  const parseAscii = (buf: ArrayBuffer): THREE.BufferGeometry => {
    const textDecoder = new TextDecoder();
    const text = textDecoder.decode(buf);
    
    const points: number[] = [];
    const normalList: number[] = [];
    
    const lines = text.split("\n");
    let currentNormal = [0, 0, 0];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("facet normal")) {
        const parts = line.split(/\s+/);
        currentNormal = [
          parseFloat(parts[2]) || 0,
          parseFloat(parts[3]) || 0,
          parseFloat(parts[4]) || 0
        ];
      } else if (line.startsWith("vertex")) {
        const parts = line.split(/\s+/);
        points.push(
          parseFloat(parts[1]) || 0,
          parseFloat(parts[2]) || 0,
          parseFloat(parts[3]) || 0
        );
        normalList.push(...currentNormal);
      }
    }
    
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
    geom.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normalList), 3));
    return geom;
  };

  return isBinary(buffer) ? parseBinary(buffer) : parseAscii(buffer);
}

export default function ThreeDViewer({
  activeArchTab,
  teeth,
  selectedReliefTeeth,
  selectedAttachmentTeeth,
  attachmentShape,
  attachmentWidth,
  attachmentHeight,
  attachmentDepth,
  baseExtrusionHeight,
  orthoBaseTemplate,
  patientIdLabel,
  labelType,
  isHollowModel,
  hollowWallThickness,
  addDrainHoles,
  articulatorNotches,
  trimScallopOffset,
  trimLineType,
  files = [],
  onToggleToothAttachment,
  onToggleToothRelief,
  onCalibrateTrimPoint,
  cadMode,
  individualTrimOffsets = {},
  compromisedTeeth = [],
  sculptMode = "none",
  brushSize = 2.0,
  sculptedPoints = [],
  onAddSculptedPoint,
  onRemoveSculptedPoint,
  auditResult,
  optimizationReasoning,
  optimizationValidation
}: ThreeDViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // State for rendering type & files — start in procedural mode to avoid fetch errors
  const [modelType, setModelType] = useState<"procedural" | "stl">("procedural");
  const [stlFiles, setStlFiles] = useState<Array<{ name: string; url: string }>>([]);
  const [selectedStlUrl, setSelectedStlUrl] = useState<string>("");
  const [isLoadingStl, setIsLoadingStl] = useState<boolean>(false);
  const [stlError, setStlError] = useState<string | null>(null);
  
  // Viewer options
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [showTrimLine, setShowTrimLine] = useState<boolean>(true);
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [materialTheme, setMaterialTheme] = useState<"plaster" | "gold" | "resin" | "translucent">("resin");
  const [showAlignerShell, setShowAlignerShell] = useState<boolean>(true);
  const [showSlicingPlane, setShowSlicingPlane] = useState<boolean>(false);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [dragOverViewer, setDragOverViewer] = useState<boolean>(false);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const autoRotateRef = useRef<boolean>(false);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  const updateCameraPositionRef = useRef<() => void>(() => {});
  updateCameraPositionRef.current = () => {
    updateCameraPosition();
  };
  
  // Three.js References for dynamic updates
  const sceneRef = useRef<THREE.Scene | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const objectsGroupRef = useRef<THREE.Group | null>(null);
  const loadedMeshRef = useRef<THREE.Mesh | null>(null);
  const stlSizeRef = useRef<THREE.Vector3>(new THREE.Vector3(64, 50, 20));

  // Mouse camera control state (custom light OrbitControls)
  const isDraggingRef = useRef<boolean>(false);
  const dragModeRef = useRef<"rotate" | "pan">("rotate");
  const previousMousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cameraTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const cameraSphericalRef = useRef<{ radius: number; phi: number; theta: number }>({
    radius: 120,
    phi: Math.PI / 4,
    theta: Math.PI / 2
  });

  // Filter and populate real STL files uploaded (skip file:// URLs blocked by browser)
  useEffect(() => {
    if (!files) return;
    const stls = files
      .filter((f) => f.name.toLowerCase().endsWith(".stl") && f.url && !f.url.startsWith("file://"))
      .map((f) => ({ name: f.name, url: f.url! }));
    
    setStlFiles((prev) => {
      const combined = [...stls];
      prev.forEach((p) => {
        if (!combined.some((c) => c.url === p.url)) {
          combined.push(p);
        }
      });
      if (JSON.stringify(prev) === JSON.stringify(combined)) {
        return prev;
      }
      return combined;
    });

    if (stls.length > 0) {
      setSelectedStlUrl(prev => {
        if (prev === stls[0].url) return prev;
        return stls[0].url;
      });
      setModelType(prev => {
        if (prev === "stl") return prev;
        return "stl";
      });
    } else {
      // No valid STL URLs — stay in procedural mode to avoid fetch errors
      setModelType("procedural");
    }
  }, [files]);

  const handleDragOverViewer = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverViewer(true);
  };

  const handleDragLeaveViewer = () => {
    setDragOverViewer(false);
  };

  const handleDropViewer = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverViewer(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith(".stl")) {
        const url = URL.createObjectURL(file);
        const newFile = { name: file.name, url };
        setStlFiles((prev) => [newFile, ...prev]);
        setSelectedStlUrl(url);
        setModelType("stl");
      } else {
        setStlError("Invalid file type. Please upload a valid 3D printable .stl model.");
      }
    }
  };

  const viewerFileInputRef = useRef<HTMLInputElement>(null);

  const handleViewerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.name.toLowerCase().endsWith(".stl")) {
        const url = URL.createObjectURL(file);
        const newFile = { name: file.name, url };
        setStlFiles((prev) => [newFile, ...prev]);
        setSelectedStlUrl(url);
        setModelType("stl");
      } else {
        setStlError("Invalid file type. Please upload a valid 3D printable .stl model.");
      }
    }
  };

  // Handle STL loader
  useEffect(() => {
    if (modelType === "stl" && selectedStlUrl) {
      loadAndRenderStl(selectedStlUrl);
    } else {
      setStlError(null);
      if (loadedMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(loadedMeshRef.current);
        loadedMeshRef.current = null;
      }
    }
  }, [modelType, selectedStlUrl]);

  // Handle dynamic param updates — STL overlay updates only
  useEffect(() => {
    if (modelType === "stl") {
      updateStlOverlays();
    }
  }, [
    selectedReliefTeeth, 
    selectedAttachmentTeeth, 
    attachmentShape, 
    attachmentWidth, 
    attachmentHeight, 
    attachmentDepth,
    baseExtrusionHeight, 
    orthoBaseTemplate, 
    patientIdLabel, 
    labelType,
    isHollowModel, 
    hollowWallThickness, 
    addDrainHoles, 
    articulatorNotches,
    trimScallopOffset, 
    trimLineType,
    wireframeMode,
    materialTheme,
    showAnnotations,
    showTrimLine,
    showSlicingPlane,
    individualTrimOffsets,
    compromisedTeeth,
    sculptMode,
    sculptedPoints,
    showAlignerShell,
    auditResult,
    optimizationReasoning,
    optimizationValidation
  ]);

  // Setup ThreeJS Canvas
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight || 450;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#FAF9F5"); // Warm clinical off-white matching theme
    sceneRef.current = scene;

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    cameraRef.current = camera;
    updateCameraPosition();

    // 3. Renderer Setup
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;
    
    // Postprocessing
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    const ssaoPass = new SSAOPass(scene, camera, width, height);
    ssaoPass.kernelRadius = 16;
    ssaoPass.minDistance = 0.005;
    ssaoPass.maxDistance = 0.1;
    composer.addPass(ssaoPass);
    
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.uniforms.resolution.value.set(1 / width, 1 / height);
    composer.addPass(fxaaPass);
    
    composerRef.current = composer;

    // 4. Lights Setup
    const ambientLight = new THREE.AmbientLight("#FAF9F5", 0.45); // Warm clinical fill
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight("#ffffff", "#777777", 0.4);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight("#ffffff", 1.35); // Key light
    dirLight1.position.set(60, 140, 90);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048; 
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.camera.near = 10;
    dirLight1.shadow.camera.far = 300;
    const d = 120;
    dirLight1.shadow.camera.left = -d;
    dirLight1.shadow.camera.right = d;
    dirLight1.shadow.camera.top = d;
    dirLight1.shadow.camera.bottom = -d;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight("#D0E4FF", 0.9); // Cool blue rim light for premium edge definition
    dirLight2.position.set(-70, 110, -80);
    scene.add(dirLight2);

    const pointLight = new THREE.PointLight("#ffffff", 0.4);
    camera.add(pointLight);
    scene.add(camera);

    // Group to hold all procedurally created assets
    const objectsGroup = new THREE.Group();
    scene.add(objectsGroup);
    objectsGroupRef.current = objectsGroup;

    // Render loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (autoRotateRef.current) {
        cameraSphericalRef.current.theta += 0.0055;
        updateCameraPositionRef.current?.();
      }
      if (rendererRef.current && sceneRef.current && cameraRef.current && composerRef.current) {
        composerRef.current.render();
      }
    };
    animate();

    // Resize Handler
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (renderer && camera && composerRef.current) {
        renderer.setSize(w, h || 450);
        camera.aspect = w / (h || 450);
        camera.updateProjectionMatrix();
        composerRef.current.setSize(w, h || 450);
      }
    });
    resizeObserver.observe(containerRef.current);

    // Load STL files if available on mount
    if (stlFiles.length > 0 && selectedStlUrl) {
      loadAndRenderStl(selectedStlUrl);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, []);

  // Update Camera based on Spherical Coordinates
  const updateCameraPosition = () => {
    if (!cameraRef.current) return;
    const cam = cameraRef.current;
    const sphere = cameraSphericalRef.current;
    const target = cameraTargetRef.current;

    const x = target.x + sphere.radius * Math.sin(sphere.phi) * Math.cos(sphere.theta);
    const y = target.y + sphere.radius * Math.cos(sphere.phi);
    const z = target.z + sphere.radius * Math.sin(sphere.phi) * Math.sin(sphere.theta);

    cam.position.set(x, y, z);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  };

  // Materials Factory based on settings
  const getSelectedMaterial = (colorOverride?: string) => {
    const isWire = wireframeMode;
    switch (materialTheme) {
      case "gold":
        return new THREE.MeshPhysicalMaterial({
          color: colorOverride || "#D4AF37",
          metalness: 0.9,
          roughness: 0.15,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05,
          wireframe: isWire,
          side: THREE.DoubleSide
        });
      case "resin":
        return new THREE.MeshPhysicalMaterial({
          color: colorOverride || "#E5C09C", // Natural Peach-Beige Model Resin
          roughness: 0.48, // Satin finish
          metalness: 0.0,
          clearcoat: 0.0,
          wireframe: isWire,
          side: THREE.DoubleSide
        });
      case "translucent":
        return new THREE.MeshPhysicalMaterial({
          color: colorOverride || "#D0E4FF", // Subtle aligner blue-tint
          roughness: 0.15,
          transmission: 0.95, // High-quality translucent thermoform sheet
          opacity: 0.9,
          transparent: true,
          thickness: 1.0,
          wireframe: isWire,
          side: THREE.DoubleSide,
          depthWrite: false
        });
      case "plaster":
      default:
        return new THREE.MeshPhysicalMaterial({
          color: colorOverride || "#F4EFE6", // Natural orthodontic gypsum stone
          roughness: 0.75, // Completely matte plaster
          metalness: 0.0,
          wireframe: isWire,
          side: THREE.DoubleSide
        });
    }
  };

  // Load actual binary or ASCII STL
  const loadAndRenderStl = async (url: string) => {
    setIsLoadingStl(true);
    setStlError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      
      const geometry = parseSTL(arrayBuffer);
      geometry.computeVertexNormals();
      geometry.center(); // Center geometry around (0,0,0)
      geometry.computeBoundingBox();
      
      const mat = getSelectedMaterial("#E5E0D5");
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.rotation.x = -Math.PI / 2; // Rotate standard Z-up STL to Y-up WebGL viewport
      mesh.position.set(0, 0, 0);

      if (objectsGroupRef.current) {
        // Clear any prior STL overlays or mesh before replacing
        while (objectsGroupRef.current.children.length > 0) {
          const obj = objectsGroupRef.current.children[0];
          objectsGroupRef.current.remove(obj);
        }
        objectsGroupRef.current.add(mesh);
      } else if (sceneRef.current) {
        sceneRef.current.add(mesh);
      }

      loadedMeshRef.current = mesh;

      const worldBox = new THREE.Box3().setFromObject(mesh);
      const worldSize = worldBox.getSize(new THREE.Vector3());
      stlSizeRef.current.copy(worldSize);
      const maxDim = Math.max(worldSize.x, worldSize.y, worldSize.z);
      const center = worldBox.getCenter(new THREE.Vector3());
      cameraTargetRef.current.copy(center);
      cameraSphericalRef.current.radius = Math.max(60, maxDim * 1.8);
      updateCameraPosition();
      updateStlOverlays();
    } catch (err: any) {
      console.error("Failed to render real STL mesh:", err);
      setStlError(err.message || "Could not parse or load STL file.");
    } finally {
      setIsLoadingStl(false);
    }
  };

  // Re-generate clinical overlay lines and elements on top of real STL model
  const updateStlOverlays = () => {
    if (modelType !== "stl") return;
    if (!objectsGroupRef.current) return;
    if (!loadedMeshRef.current) return;

    const group = objectsGroupRef.current;
    // Clear old overlays but keep the loaded mesh if present
    const existingLoadedMesh = loadedMeshRef.current;
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
    group.add(existingLoadedMesh);

    const worldBox = new THREE.Box3().setFromObject(existingLoadedMesh);
    const worldSize = worldBox.getSize(new THREE.Vector3());
    const center = worldBox.getCenter(new THREE.Vector3());
    stlSizeRef.current.copy(worldSize);

    const width = Math.max(worldSize.x, 10);
    const height = Math.max(worldSize.y, 5);
    const depth = Math.max(worldSize.z, 10);
    const isUpper = activeArchTab === "upper";

    const trimBaseY = center.y + (isUpper ? height * -0.08 : height * 0.08);
    const trimRadiusX = width * 0.44;
    const trimRadiusZ = depth * 0.44;

    if (showTrimLine) {
      const trimPoints: THREE.Vector3[] = [];
      const toothCount = Math.max(teeth.length, 8);

      for (let i = 0; i < toothCount; i++) {
        const theta = (i / (toothCount - 1)) * Math.PI - Math.PI / 2;
        const x = trimRadiusX * Math.sin(theta) + center.x;
        const z = trimRadiusZ * Math.cos(theta) - trimRadiusZ * 0.08 + center.z;
        const wave = trimLineType === "scalloped" ? Math.sin(i * 3.2) * 1.5 : 0;
        const y = trimBaseY + (trimScallopOffset - 1.5) * 1.2 + wave * (isUpper ? -1 : 1);
        trimPoints.push(new THREE.Vector3(x, y, z));
      }
      trimPoints.push(trimPoints[0]);

      const trimCurve = new THREE.CatmullRomCurve3(trimPoints);
      const tubeGeom = new THREE.TubeGeometry(trimCurve, 80, 0.55, 8, true);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: "#46c0bd",
        roughness: 0.3,
        metalness: 0.1
      });
      const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
      group.add(tubeMesh);
    }

    teeth.forEach((t, i) => {
      const isSelectedRelief = selectedReliefTeeth.includes(t.id);
      const hasAttachment = selectedAttachmentTeeth.includes(t.id);
      if (!isSelectedRelief && !hasAttachment) return;
      if (!showAnnotations) return;

      const theta = (i / (teeth.length - 1)) * Math.PI - Math.PI / 2;
      const tx = trimRadiusX * Math.sin(theta) + center.x;
      const tz = trimRadiusZ * Math.cos(theta) - trimRadiusZ * 0.08 + center.z;
      const ty = center.y + (isUpper ? -height * 0.14 : height * 0.14);

      if (hasAttachment) {
        const geom = attachmentShape === "ellipsoid"
          ? new THREE.SphereGeometry(attachmentWidth * 0.45, 12, 12)
          : new THREE.BoxGeometry(attachmentWidth * 0.7, attachmentHeight * 0.7, attachmentDepth * 0.7);
        const mat = new THREE.MeshStandardMaterial({
          color: "#D97706",
          roughness: 0.4,
          metalness: 0.2
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(tx, ty, tz);
        mesh.lookAt(new THREE.Vector3(center.x + tx * 0.15, ty, tz));
        group.add(mesh);
      }

      if (isSelectedRelief) {
        const geom = new THREE.SphereGeometry(Math.max(attachmentWidth * 0.8, 3.5), 16, 16);
        const mat = new THREE.MeshStandardMaterial({
          color: "#ea580c",
          transparent: true,
          opacity: 0.55,
          roughness: 0.3
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(tx, ty, tz);
        group.add(mesh);
      }
    });

    if (showSlicingPlane) {
      const sliceGeom = new THREE.BoxGeometry(width * 1.5, depth * 1.5, 0.35);
      const sliceMat = new THREE.MeshBasicMaterial({
        color: "#06b6d4",
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
      });
      const sliceMesh = new THREE.Mesh(sliceGeom, sliceMat);
      const sliceY = center.y + (isUpper ? -height * 0.12 : height * 0.12);
      sliceMesh.position.set(center.x, sliceY, center.z);
      group.add(sliceMesh);
    }

    if (auditResult?.recommendations?.length) {
      const highlightedToothIds = new Set<number>();
      const toothIdRegex = /\btooth\s*#?(\d{1,2})\b/gi;
      auditResult.recommendations.forEach((rec) => {
        let match;
        while ((match = toothIdRegex.exec(rec)) !== null) {
          highlightedToothIds.add(parseInt(match[1], 10));
        }
      });

      highlightedToothIds.forEach((toothId) => {
        const toothIndex = teeth.findIndex((t) => t.id === toothId);
        if (toothIndex < 0) return;

        const theta = (toothIndex / (teeth.length - 1)) * Math.PI - Math.PI / 2;
        const tx = trimRadiusX * Math.sin(theta) + center.x;
        const tz = trimRadiusZ * Math.cos(theta) - trimRadiusZ * 0.08 + center.z;
        const ty = center.y + (isUpper ? -height * 0.08 : height * 0.08);

        const markerGeom = new THREE.SphereGeometry(Math.max(1.2, width * 0.01), 16, 16);
        const markerMat = new THREE.MeshStandardMaterial({
          color: "#ef4444",
          transparent: true,
          opacity: 0.85,
          emissive: "#ffebe9",
          emissiveIntensity: 0.35
        });
        const markerMesh = new THREE.Mesh(markerGeom, markerMat);
        markerMesh.position.set(tx, ty, tz);
        group.add(markerMesh);

        const labelGeom = new THREE.RingGeometry(1.6, 2.0, 24);
        const labelMat = new THREE.MeshBasicMaterial({ color: "#ef4444", side: THREE.DoubleSide, transparent: true, opacity: 0.72 });
        const labelMesh = new THREE.Mesh(labelGeom, labelMat);
        labelMesh.rotation.x = Math.PI / 2;
        labelMesh.position.set(tx, ty + 1.6, tz);
        group.add(labelMesh);
      });
    }
  };

  // Click handler on 3D canvas (using coordinates to raycast)
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !cameraRef.current || !objectsGroupRef.current) return;
    
    // Calculate normalized device coordinates
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

    // If sculptMode is active, handle drawing/erasing material
    if (sculptMode && sculptMode !== "none") {
      const intersects = raycaster.intersectObjects(objectsGroupRef.current.children, true);
      if (intersects.length > 0) {
        // Find first intersect that isn't an invisible picker geometry
        const validIntersect = intersects.find(i => i.object.visible !== false);
        if (validIntersect) {
          const pt = validIntersect.point;
          if (sculptMode === "draw" && onAddSculptedPoint) {
            onAddSculptedPoint({ x: pt.x, y: pt.y, z: pt.z, size: brushSize });
          } else if (sculptMode === "erase" && onRemoveSculptedPoint && sculptedPoints.length > 0) {
            // Find closest sculpted point to erase within safety threshold
            let closestIndex = -1;
            let minDist = Infinity;
            sculptedPoints.forEach((sPt, index) => {
              const dx = sPt.x - pt.x;
              const dy = sPt.y - pt.y;
              const dz = sPt.z - pt.z;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dist < minDist) {
                minDist = dist;
                closestIndex = index;
              }
            });
            if (closestIndex !== -1 && minDist < brushSize * 2.5) {
              onRemoveSculptedPoint(closestIndex);
            }
          }
        }
      }
      return; // Intercept normal click events
    }

    // Get all picker bounds
    const intersects = raycaster.intersectObjects(objectsGroupRef.current.children, true);
    
    // Find first clicked picker tooth
    const intersectedPicker = intersects.find(
      (intersect) => intersect.object.userData && intersect.object.userData.toothId
    );

    if (intersectedPicker) {
      const clickedToothId = intersectedPicker.object.userData.toothId;
      if (cadMode === "attachments" && onToggleToothAttachment) {
        onToggleToothAttachment(clickedToothId);
      } else if (cadMode === "relief" && onToggleToothRelief) {
        onToggleToothRelief(clickedToothId);
      }
    } else if (isCalibrating && onCalibrateTrimPoint) {
       // Raycast against the main model
       if (loadedMeshRef.current) {
         const intersects = raycaster.intersectObject(loadedMeshRef.current);
         if (intersects.length > 0) {
           onCalibrateTrimPoint(intersects[0].point);
         }
       }
    }
  };

  // Mouse camera control dragging events
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragModeRef.current = e.shiftKey || e.button === 1 || e.button === 2 ? "pan" : "rotate";
    previousMousePositionRef.current = {
      x: e.clientX,
      y: e.clientY
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;

    const deltaX = e.clientX - previousMousePositionRef.current.x;
    const deltaY = e.clientY - previousMousePositionRef.current.y;

    const sphere = cameraSphericalRef.current;
    const target = cameraTargetRef.current;

    if (dragModeRef.current === "rotate") {
      // Rotation
      sphere.theta -= deltaX * 0.007;
      sphere.phi -= deltaY * 0.007;

      // Cap phi to avoid camera flipping over poles
      sphere.phi = Math.max(0.1, Math.min(Math.PI - 0.1, sphere.phi));
    } else {
      // Panning
      const panSpeed = sphere.radius * 0.002;
      const theta = sphere.theta;

      // Calculate camera orthogonal vectors
      const forwardX = Math.sin(theta);
      const forwardZ = Math.cos(theta);
      const rightX = -forwardZ;
      const rightZ = forwardX;

      target.x -= deltaX * panSpeed * rightX;
      target.z -= deltaX * panSpeed * rightZ;
      target.y += deltaY * panSpeed;
    }

    previousMousePositionRef.current = {
      x: e.clientX,
      y: e.clientY
    };

    updateCameraPosition();
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    const sphere = cameraSphericalRef.current;
    sphere.radius += e.deltaY * 0.12;
    sphere.radius = Math.max(20, Math.min(300, sphere.radius));
    updateCameraPosition();
  };

  return (
    <div className="flex flex-col h-full w-full relative">
      {/* 3D View Top Control Bar */}
      <div className="bg-slate-900 text-white p-3 rounded-t-xl flex flex-wrap items-center justify-between gap-3 shadow-sm select-none z-10 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#46c0bd]" />
          <span className="text-xs font-extrabold tracking-wider uppercase font-sans">Dental CAD 3D Viewport</span>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCalibrating(!isCalibrating)}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-1.5 ${
              isCalibrating
                ? "bg-rose-600 text-white animate-pulse"
                : "bg-slate-700 text-slate-300 hover:text-white"
            }`}
            title="Calibrate Trim Line"
          >
            <MousePointer className="w-3 h-3" />
            {isCalibrating ? "Click on Model to Snap" : "Calibrate Trim Line"}
          </button>
          
          <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-lg">
            <button
              onClick={() => setModelType("stl")}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-1 ${
                modelType === "stl"
                  ? "bg-slate-700 text-white border border-slate-600"
                  : "text-slate-400 hover:text-white"
              }`}
              title="Load or upload real clinical STL scan"
            >
              <FileCode className="w-3 h-3 text-[#46c0bd]" />
              Real STL Scan
            </button>
          </div>
        </div>

        {/* Quick Material Picker */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-400 uppercase font-bold hidden sm:inline">Finish:</span>
          <select
            value={materialTheme}
            onChange={(e: any) => setMaterialTheme(e.target.value)}
            className="bg-slate-800 text-[10px] text-slate-200 border border-slate-700 rounded-md py-0.5 px-2 focus:outline-none focus:ring-1 focus:ring-[#46c0bd]"
          >
            <option value="plaster">Matte Plaster (Standard)</option>
            <option value="resin">SLA Amber Resin</option>
            <option value="translucent">Refractive Clear Gel</option>
            <option value="gold">24K Electro-Gold</option>
          </select>
        </div>
      </div>

      {/* 3D Canvas Area Container */}
      <div 
        ref={containerRef}
        className={`relative flex-1 bg-[#FAF9F5] min-h-[280px] max-h-[380px] w-full flex items-center justify-center cursor-grab active:cursor-grabbing border-x border-b border-slate-200 rounded-b-xl overflow-hidden shadow-inner transition-all duration-200 ${
          dragOverViewer ? "ring-4 ring-inset ring-[#46c0bd] bg-[#eefaf9]/40" : ""
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOverViewer}
        onDragLeave={handleDragLeaveViewer}
        onDrop={handleDropViewer}
      >
        {/* Real STL File Selection overlay */}
        {modelType === "stl" && stlFiles.length > 0 && (
          <div className="absolute top-3 left-3 bg-slate-900/95 backdrop-blur-xs text-white border border-slate-800 rounded-lg p-2.5 z-10 shadow-lg space-y-1.5 max-w-xs transition-all duration-200">
            <label className="text-[9px] uppercase font-extrabold text-[#46c0bd] block">Select Active STL Mesh:</label>
            <select
              value={selectedStlUrl}
              onChange={(e) => setSelectedStlUrl(e.target.value)}
              className="bg-slate-800 text-[10px] text-slate-100 border border-slate-700 rounded-md p-1.5 w-full focus:outline-none mb-1"
            >
              {stlFiles.map((file) => (
                <option key={file.url} value={file.url}>
                  {file.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => viewerFileInputRef.current?.click()}
              className="w-full bg-[#46c0bd] hover:bg-[#3ba6a3] text-white text-[9px] font-bold py-1 rounded transition-colors text-center cursor-pointer flex items-center justify-center gap-1"
            >
              <span>+ Upload New Scan</span>
            </button>
            <input 
              ref={viewerFileInputRef}
              type="file"
              accept=".stl"
              onChange={handleViewerFileChange}
              className="hidden"
            />
          </div>
        )}

        {/* Floating Upload Drop-Zone if STL mode has zero meshes loaded */}
        {modelType === "stl" && stlFiles.length === 0 && (
          <div 
            onClick={() => viewerFileInputRef.current?.click()}
            className="absolute inset-4 border-2 border-dashed border-[#46c0bd]/60 bg-slate-900/90 rounded-xl flex flex-col items-center justify-center p-6 text-center text-white cursor-pointer hover:bg-slate-900/95 hover:border-[#46c0bd] transition-all z-10 gap-3"
          >
            <div className="p-3 bg-[#46c0bd]/20 rounded-full text-[#46c0bd] animate-pulse">
              <FileCode className="w-8 h-8" />
            </div>
            <div>
              <p className="font-bold text-sm">Upload Local STL Dental Scan</p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                Drag & drop your mandibular or maxillary scan (.stl) here, or click to browse workstation files.
              </p>
            </div>
            <button className="bg-[#46c0bd] hover:bg-[#3ba6a3] text-white text-[11px] font-bold px-4 py-2 rounded-lg transition-colors shadow-sm">
              Browse Workstation Files
            </button>
            <input 
              ref={viewerFileInputRef}
              type="file"
              accept=".stl"
              onChange={handleViewerFileChange}
              className="hidden"
            />
          </div>
        )}

        {/* Overlay Controls (Floating) */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-10">
          {/* Toggle Annotations */}
          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            className={`p-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer shadow-md ${
              showAnnotations 
                ? "bg-slate-900 border-slate-800 text-white" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="Toggle Attachments / Blockouts in 3D"
          >
            {showAnnotations ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="text-[10px] hidden sm:inline">Annotations</span>
          </button>

          {/* Toggle Trim Line */}
          <button
            onClick={() => setShowTrimLine(!showTrimLine)}
            className={`p-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer shadow-md ${
              showTrimLine 
                ? "bg-slate-900 border-slate-800 text-white" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="Toggle Laser Cutting Scallop Line in 3D"
          >
            {showTrimLine ? <Sparkles className="w-3.5 h-3.5 text-[#46c0bd]" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="text-[10px] hidden sm:inline">Trim Line</span>
          </button>

          {/* Toggle Aligner Shell */}
          <button
            onClick={() => setShowAlignerShell(!showAlignerShell)}
            className={`p-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer shadow-md ${
              showAlignerShell 
                ? "bg-blue-600 border-blue-700 text-white animate-pulse" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="Toggle Translucent Fabricated Aligner Shell fitting"
          >
            <Layers className={`w-3.5 h-3.5 ${showAlignerShell ? "text-white" : "text-blue-500"}`} />
            <span className="text-[10px] hidden sm:inline">Aligner Shell</span>
          </button>

          {/* Toggle Wireframe */}
          <button
            onClick={() => setWireframeMode(!wireframeMode)}
            className={`p-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer shadow-md ${
              wireframeMode 
                ? "bg-[#46c0bd] border-[#3ba6a3] text-white" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="Toggle Wireframe Mesh Geometry Mode"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden sm:inline">Wireframe</span>
          </button>

          {/* Toggle Slicing Plane */}
          <button
            onClick={() => setShowSlicingPlane(!showSlicingPlane)}
            className={`p-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer shadow-md ${
              showSlicingPlane 
                ? "bg-cyan-600 border-cyan-700 text-white animate-pulse" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="Toggle horizontal 3D slicing plane visualization"
          >
            <Layers className="w-3.5 h-3.5 text-cyan-500" />
            <span className="text-[10px] hidden sm:inline">Slice Plane</span>
          </button>

          {/* Toggle Auto-Rotate Turntable */}
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`p-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer shadow-md ${
              autoRotate 
                ? "bg-indigo-600 border-indigo-700 text-white" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="Toggle continuous 360° turntable presentation spin"
          >
            <RotateCcw className={`w-3.5 h-3.5 text-indigo-500 ${autoRotate ? "animate-spin text-white" : ""}`} />
            <span className="text-[10px] hidden sm:inline">Auto Spin</span>
          </button>

          {/* Reset View */}
          <button
            onClick={() => {
              cameraTargetRef.current.set(0, baseExtrusionHeight / 2, 0);
              cameraSphericalRef.current = {
                radius: 120,
                phi: Math.PI / 4,
                theta: Math.PI / 2
              };
              updateCameraPosition();
            }}
            className="p-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold shadow-md flex items-center justify-center gap-1 cursor-pointer"
            title="Reset viewport angle"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="text-[10px] hidden sm:inline">Reset Camera</span>
          </button>
        </div>

        {/* Loading Spinner */}
        {isLoadingStl && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center text-white z-20 transition-all duration-300">
            <Loader2 className="w-8 h-8 text-[#46c0bd] animate-spin mb-2" />
            <span className="text-xs font-bold uppercase tracking-wider">Parsing & Rendering STL Mesh...</span>
            <span className="text-[10px] text-slate-400 mt-1">Extracting digital facet boundaries</span>
          </div>
        )}

        {/* STL File Parse Error Overlay - Dismissible */}
        {stlError && (
          <div className="absolute inset-x-4 top-16 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs z-20 flex flex-col gap-2 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="font-bold">⚠️ STL Parsing Exception</span>
              <button
                onClick={() => { setStlError(null); setModelType("procedural"); }}
                className="p-1 hover:bg-rose-100 rounded cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="font-mono text-[10px] bg-white p-2 rounded border border-rose-100 block whitespace-pre-wrap">{stlError}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setStlError(null); setModelType("procedural"); }}
                className="text-[10px] bg-rose-800 hover:bg-rose-900 text-white font-bold px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                Switch to Procedural View
              </button>
              <span className="text-[10px] text-slate-500">Or load a local .stl file</span>
            </div>
          </div>
        )}

        {/* Canvas elements */}
        <canvas 
          ref={canvasRef} 
          onClick={handleCanvasClick}
          className="w-full h-full block touch-none" 
        />

        {/* Real-time floating HUD stats */}
        <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-lg p-2.5 text-[10px] font-mono text-slate-600 shadow-sm z-10 space-y-1 max-w-[200px] pointer-events-none">
          <div className="text-slate-800 font-bold border-b border-slate-100 pb-1 mb-1 flex items-center gap-1 uppercase text-[9px] tracking-wide">
            <MousePointer className="w-3 h-3 text-[#46c0bd]" /> 
            Interaction HUD
          </div>
          <div>VIEW: REAL STL SCAN</div>
          <div>BASE: {orthoBaseTemplate === "horseshoe" ? "HORSESHOE" : orthoBaseTemplate === "tweed_abo" ? "ABO STUDY BASE" : "3SHAPE BAR BRIDGE"}</div>
          <div>HEIGHT: {baseExtrusionHeight} mm</div>
          {isHollowModel && <div>HOLLOW WALL: {hollowWallThickness} mm</div>}
          <div>TRIM OFF: {trimScallopOffset} mm</div>
          <div className="text-[9px] font-sans text-slate-400 border-t border-slate-100 pt-1 mt-1 leading-normal">
            🖱️ Left Drag: Rotate | Shift+Drag: Pan | Scroll: Zoom
          </div>
        </div>
      </div>
    </div>
  );
}
