import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import * as UTIF from 'utif';
import { detectParticles, drawParticles } from './services/particleDetectionService';
import OpenCvWrapper, { useOpenCv } from './components/OpenCvProvider';
import './App.css';

function App() {
  const [image, setImage] = useState(null);
  const [processedImage, setProcessedImage] = useState(null);
  const [particles, setParticles] = useState([]);
  const [scaleInput, setScaleInput] = useState({
    pixels: 0,
    micrometers: 0
  });
  const [detectionParams, setDetectionParams] = useState({
    minRadius: 9,
    maxRadius: 38,
    threshold: 27,
    minArea: 30
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewPosition, setViewPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [selectedParticle, setSelectedParticle] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [originalParticles, setOriginalParticles] = useState([]);
  const [editedParticles, setEditedParticles] = useState([]);
  const [isMoving, setIsMoving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [idInput, setIdInput] = useState('');
  const [interactionMode, setInteractionMode] = useState('edit'); // 'edit' or 'pan'
  const [panSensitivity, setPanSensitivity] = useState(0.25);
  const [zoomSensitivity, setZoomSensitivity] = useState(0.05);
  
  const canvasRef = useRef(null);
  const resultCanvasRef = useRef(null);
  const { cv, isLoaded, loadingStatus, forceEnable } = useOpenCv();

  // Refs for canvas and containers
  const fileInputRef = useRef(null);
  const originalCanvasRef = useRef(null);
  const originalContainerRef = useRef(null);
  const imageContainerRef = useRef(null);

  // Use this approach instead of declaring scaleRatio multiple times
  const scaleRatio = useMemo(() => {
    if (scaleInput.pixels <= 0 || scaleInput.micrometers <= 0) return 0;
    return scaleInput.micrometers / scaleInput.pixels;
  }, [scaleInput.pixels, scaleInput.micrometers]);

  // Then you don't need a separate calculateScaleRatio function
  // Or if you want to keep it for clarity:
  const calculateScaleRatio = () => {
    if (scaleInput.pixels <= 0 || scaleInput.micrometers <= 0) return 0;
    return scaleInput.micrometers / scaleInput.pixels;
  };

  // Handle image upload via dropzone
  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.tif', '.tiff']
    },
    onDrop: acceptedFiles => {
      const file = acceptedFiles[0];
      
      if (file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff')) {
        handleTiffFile(file);
      } else {
        const reader = new FileReader();
        
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            setImage(img);
          };
          img.src = event.target.result;
        };
        
        reader.readAsDataURL(file);
      }
    }
  });

  // Handle TIFF file upload
  const handleTiffFile = (file) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const buffer = event.target.result;
        const ifds = UTIF.decode(buffer);
        
        if (ifds && ifds.length > 0) {
          const firstIfd = ifds[0];
          
          UTIF.decodeImage(buffer, firstIfd);
          
          const width = firstIfd.width;
          const height = firstIfd.height;
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          const rgba = UTIF.toRGBA8(firstIfd);
          
          const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
          ctx.putImageData(imgData, 0, 0);
          
          const img = new Image();
          img.onload = () => {
            setImage(img);
          };
          img.src = canvas.toDataURL();
        } else {
          throw new Error("Failed to decode TIFF file");
        }
      } catch (error) {
        console.error("Error processing TIFF file:", error);
        alert(`Error processing TIFF file: ${error.message}`);
      }
    };
    
    reader.readAsArrayBuffer(file);
  };

  // Draw the image on canvas when it's loaded
  useEffect(() => {
    if (image && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      canvas.width = image.width;
      canvas.height = image.height;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      
      // Reset particles when a new image is loaded
      setParticles([]);
      setProcessedImage(null);
    }
  }, [image]);

  // Handle parameter changes
  const handleParamChange = (param, value) => {
    setDetectionParams(prev => ({
      ...prev,
      [param]: parseInt(value, 10)
    }));
  };

  // Update the scale input handler
  const handleScaleInputChange = (e) => {
    const { name, value } = e.target;
    setScaleInput(prev => ({
      ...prev,
      [name]: parseFloat(value) || 0
    }));
  };

  // Process the image and detect particles
  const processImage = () => {
    // Calculate the current scale ratio before processing
    const currentRatio = calculateScaleRatio();
    
    // If OpenCV isn't loaded but we're in forced mode, try to use it anyway
    if (!cv && loadingStatus === 'forced') {
      if (window.cv) {
        // Use window.cv directly if available
        processWithOpenCV(window.cv);
      } else {
        alert("OpenCV is not available. Please try refreshing the page.");
      }
      return;
    }
    
    // Normal flow when OpenCV is properly loaded
    if (!isLoaded || !cv || !image || !canvasRef.current) {
      alert("OpenCV is not loaded or no image is selected");
      return;
    }

    processWithOpenCV(cv);
  };
  
  // Separate the OpenCV processing logic
  const processWithOpenCV = (cvInstance) => {
    setIsProcessing(true);

    try {
      // Get image data from canvas
      const canvas = canvasRef.current;
      const src = cvInstance.imread(canvas);
      
      // Detect particles
      const detectedParticles = detectParticles(cvInstance, src, {
        minRadius: detectionParams.minRadius,
        maxRadius: detectionParams.maxRadius,
        threshold1: 100, // Fixed value for Canny edge detection
        threshold2: detectionParams.threshold
      });
      
      // Filter by minimum area if needed
      const filteredParticles = detectedParticles.filter(
        particle => particle.area >= detectionParams.minArea
      );
      
      // Add sequential IDs
      const particlesWithIds = filteredParticles.map((p, index) => ({
        ...p,
        id: (index + 1)
      }));
      
      setParticles(particlesWithIds);
      setOriginalParticles(particlesWithIds);
      setEditedParticles(particlesWithIds);
      
      // Draw particles on the image with IDs instead of pixel sizes
      const output = drawParticlesWithIds(cvInstance, src, particlesWithIds);
      
      // Display the processed image
      cvInstance.imshow(resultCanvasRef.current, output);
      
      // Clean up
      src.delete();
      output.delete();
    } catch (error) {
      console.error("Error processing image:", error);
      alert(`Error processing image: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Export results as CSV
  const exportResults = () => {
    if (editedParticles.length === 0) return;
    
    // Create CSV content
    let csvContent = "ID,X,Y,Diameter (px),Diameter (µm),Area (px²)\n";
    
    editedParticles.forEach(particle => {
      const diameterMicrometers = (particle.diameter * scaleRatio).toFixed(3);
      csvContent += `${particle.id},${particle.x},${particle.y},${particle.diameter},${diameterMicrometers},${particle.area}\n`;
    });
    
    // Create a blob and download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'particle_data.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Add these functions for zoom and pan functionality
  const handleZoomChange = (e) => {
    const newZoom = parseFloat(e.target.value);
    setZoom(newZoom);
    
    // Reset position when zooming out to 1x
    if (newZoom === 1) {
      setViewPosition({ x: 0, y: 0 });
    }
  };

  const handleMouseDown = (e, containerRef) => {
    if (containerRef.current) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX,
        y: e.clientY
      });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging && dragStart) {
      // Calculate the movement delta
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      // Apply a sensitivity factor to reduce the movement speed
      const panSensitivity = 0.5; // 0.5 = half speed
      
      // Update the view position with reduced sensitivity
      setViewPosition({
        x: viewPosition.x + (dx * panSensitivity),
        y: viewPosition.y + (dy * panSensitivity)
      });
      
      // Update the drag start position
      setDragStart({
        x: e.clientX,
        y: e.clientY
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStart(null);
  };

  // Add effect for global mouse events
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };
    
    const handleGlobalMouseMove = (e) => {
      if (isDragging) {
        handleMouseMove(e);
      }
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [isDragging, dragStart]);

  // Add this function to draw particles with IDs
  const drawParticlesWithIds = (cv, imgMat, particles, selectedParticle = null) => {
    try {
      const output = imgMat.clone();
      const regularColor = new cv.Scalar(0, 255, 0, 255); // Green
      const selectedColor = new cv.Scalar(255, 0, 0, 255); // Red
      
      particles.forEach(particle => {
        if (particle.x >= 0 && particle.x < output.cols && 
            particle.y >= 0 && particle.y < output.rows) {
          
          const center = new cv.Point(particle.x, particle.y);
          const isSelected = selectedParticle && particle.id === selectedParticle.id;
          const color = isSelected ? selectedColor : regularColor;
          
          // Draw circle outline
          cv.circle(output, center, particle.radius, color, 2);
          
          // Draw center point
          cv.circle(output, center, 2, color, -1);
          
          // Add text with ID
          const text = `${particle.id}`;
          const textOrg = new cv.Point(
            Math.max(particle.x - 10, 0), 
            Math.max(particle.y - particle.radius - 5, 15)
          );
          cv.putText(output, text, textOrg, cv.FONT_HERSHEY_SIMPLEX, 0.5, color, 1);
          
          // If selected, draw resize handles
          if (isSelected) {
            // Draw resize handles at cardinal points
            const handlePoints = [
              new cv.Point(center.x + particle.radius, center.y), // East
              new cv.Point(center.x, center.y - particle.radius), // North
              new cv.Point(center.x - particle.radius, center.y), // West
              new cv.Point(center.x, center.y + particle.radius)  // South
            ];
            
            handlePoints.forEach(point => {
              cv.circle(output, point, 4, selectedColor, -1);
            });
          }
        }
      });
      
      return output;
    } catch (error) {
      console.error("Error in drawParticlesWithIds:", error);
      throw error;
    }
  };

  // Add this function to handle particle selection
  const handleParticleSelect = (particleId) => {
    const particle = particles.find(p => p.id === particleId);
    if (particle) {
      setSelectedParticle(particle);
    }
  };

  // Add this function to toggle edit mode
  const toggleEditMode = () => {
    if (!editMode) {
      // When entering edit mode, save the original particles
      setOriginalParticles([...particles]);
      setEditedParticles([...particles]);
    } else {
      // When exiting edit mode, apply changes
      setParticles([...editedParticles]);
      setSelectedParticle(null);
    }
    setEditMode(!editMode);
  };

  // Add this function to toggle interaction mode
  const toggleInteractionMode = () => {
    setInteractionMode(prev => prev === 'edit' ? 'pan' : 'edit');
    
    // Reset any active interactions
    setIsDragging(false);
    setIsMoving(false);
    setIsResizing(false);
  };

  // Update the handleCanvasMouseDown function to properly handle particle selection and dragging
  const handleCanvasMouseDown = (e) => {
    if (!resultCanvasRef.current || !imageContainerRef.current) return;
    
    const canvas = resultCanvasRef.current;
    const container = imageContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Calculate the actual position on the canvas, accounting for zoom and pan
    const x = ((e.clientX - rect.left) - viewPosition.x) / zoom;
    const y = ((e.clientY - rect.top) - viewPosition.y) / zoom;
    
    // Store the initial mouse position for potential panning
    setDragStart({
      x: e.clientX,
      y: e.clientY
    });
    
    // If we're in pan mode, just handle panning
    if (interactionMode === 'pan') {
      setIsDragging(true);
      return;
    }
    
    // If we're already moving or resizing, clicking should drop the particle
    if (isMoving || isResizing) {
      setIsMoving(false);
      setIsResizing(false);
      return;
    }
    
    // In edit mode, check for particle interactions
    let clickedOnParticle = false;
    
    // If we have a selected particle, check if we're interacting with it
    if (selectedParticle) {
      const distance = Math.sqrt(
        Math.pow(selectedParticle.x - x, 2) + 
        Math.pow(selectedParticle.y - y, 2)
      );
      
      // Check if click is on the circle border (for resizing)
      const onBorder = Math.abs(distance - selectedParticle.radius) < 10;
      // Check if click is inside the circle (for moving)
      const inside = distance < selectedParticle.radius;
      
      if (onBorder) {
        setIsResizing(true);
        setIsMoving(false);
        clickedOnParticle = true;
        e.preventDefault(); // Prevent other mouse events
        return;
      } else if (inside) {
        setIsMoving(true);
        setIsResizing(false);
        clickedOnParticle = true;
        e.preventDefault(); // Prevent other mouse events
        return;
      }
    }
    
    // If we didn't interact with the selected particle, check other particles
    if (!clickedOnParticle) {
      for (const p of editedParticles) {
        const distance = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
        // Check if click is on the circle border (for resizing)
        const onBorder = Math.abs(distance - p.radius) < 10;
        // Check if click is inside the circle (for moving)
        const inside = distance < p.radius;
        
        if (onBorder || inside) {
          setSelectedParticle(p);
          clickedOnParticle = true;
          
          if (onBorder) {
            setIsResizing(true);
            setIsMoving(false);
          } else if (inside) {
            setIsMoving(true);
            setIsResizing(false);
          }
          
          e.preventDefault(); // Prevent other mouse events
          break;
        }
      }
    }
    
    // If we didn't click on any particle and we're zoomed in, start panning
    if (!clickedOnParticle && zoom > 1) {
      setIsDragging(true);
      
      // If we have a selected particle but didn't click on it or its border,
      // deselect it (drop the sphere)
      if (selectedParticle) {
        setSelectedParticle(null);
      }
    } else if (!clickedOnParticle) {
      // If we didn't click on any particle and we're not zoomed in,
      // just deselect the current particle if there is one
      if (selectedParticle) {
        setSelectedParticle(null);
      }
    }
  };
  
  // Update the handleCanvasMouseMove function to properly handle particle dragging
  const handleCanvasMouseMove = (e) => {
    if (!resultCanvasRef.current || !imageContainerRef.current) return;
    
    const canvas = resultCanvasRef.current;
    const container = imageContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Calculate the actual position on the canvas, accounting for zoom and pan
    const x = ((e.clientX - rect.left) - viewPosition.x) / zoom;
    const y = ((e.clientY - rect.top) - viewPosition.y) / zoom;
    
    // Handle panning if we're dragging the canvas
    if (isDragging && dragStart) {
      // Calculate the movement delta
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      // Apply a sensitivity factor to reduce the movement speed
      const panSensitivity = 0.5; // 0.5 = half speed
      
      // Update the view position with reduced sensitivity
      setViewPosition({
        x: viewPosition.x + (dx * panSensitivity),
        y: viewPosition.y + (dy * panSensitivity)
      });
      
      // Update the drag start position
      setDragStart({
        x: e.clientX,
        y: e.clientY
      });
      
      return;
    }
    
    // Handle particle interactions
    if (selectedParticle) {
      if (isMoving) {
        // Create a copy of the selected particle with updated position
        const updatedParticle = {
          ...selectedParticle,
          x: x,
          y: y
        };
        
        // Update the selected particle
        setSelectedParticle(updatedParticle);
        
        // Update the particle in the editedParticles array
        const updatedParticles = editedParticles.map(p => 
          p.id === selectedParticle.id ? updatedParticle : p
        );
        
        setEditedParticles(updatedParticles);
        
        // Redraw the particles
        redrawParticles();
        
        e.preventDefault(); // Prevent other mouse events
      } else if (isResizing) {
        // Calculate the distance from the center of the particle to the current mouse position
        const distance = Math.sqrt(
          Math.pow(selectedParticle.x - x, 2) + 
          Math.pow(selectedParticle.y - y, 2)
        );
        
        // Create a copy of the selected particle with updated radius and diameter
        const updatedParticle = {
          ...selectedParticle,
          radius: distance,
          diameter: distance * 2
        };
        
        // Update the selected particle
        setSelectedParticle(updatedParticle);
        
        // Update the particle in the editedParticles array
        const updatedParticles = editedParticles.map(p => 
          p.id === selectedParticle.id ? updatedParticle : p
        );
        
        setEditedParticles(updatedParticles);
        
        // Redraw the particles
        redrawParticles();
        
        e.preventDefault(); // Prevent other mouse events
      }
    }
    
    // Update cursor based on what's under it
    if (selectedParticle) {
      const distance = Math.sqrt(
        Math.pow(selectedParticle.x - x, 2) + 
        Math.pow(selectedParticle.y - y, 2)
      );
      
      const onBorder = Math.abs(distance - selectedParticle.radius) < 10;
      const inside = distance < selectedParticle.radius;
      
      if (onBorder) {
        container.style.cursor = 'nwse-resize';
      } else if (inside) {
        container.style.cursor = 'grab';
      } else {
        container.style.cursor = 'default';
      }
    } else {
      // Check if mouse is over any particle
      let overParticle = false;
      
      for (const p of editedParticles) {
        const distance = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
        const onBorder = Math.abs(distance - p.radius) < 10;
        const inside = distance < p.radius;
        
        if (onBorder) {
          container.style.cursor = 'nwse-resize';
          overParticle = true;
          break;
        } else if (inside) {
          container.style.cursor = 'grab';
          overParticle = true;
          break;
        }
      }
      
      if (!overParticle) {
        container.style.cursor = zoom > 1 ? 'grab' : 'default';
      }
    }
  };
  
  // Update the handleCanvasMouseUp function to properly handle the end of interactions
  const handleCanvasMouseUp = (e) => {
    // Reset dragging state
    setIsDragging(false);
    setDragStart(null);
    
    // If we were moving or resizing, stop those actions
    if (isMoving || isResizing) {
      setIsMoving(false);
      setIsResizing(false);
      
      // Make sure to redraw the particles to show the final position/size
      redrawParticles();
    }
  };

  // Add this function to handle mouse leave events
  const handleCanvasMouseLeave = (e) => {
    // Reset dragging state when mouse leaves the canvas
    setIsDragging(false);
    setDragStart(null);
    
    // Don't reset moving and resizing on mouse leave to allow for smoother interactions
  };

  // Add this function to redraw particles
  const redrawParticles = () => {
    if (!cv || !resultCanvasRef.current) return;
    
    try {
      const src = cv.imread(canvasRef.current);
      const output = drawParticlesWithIds(cv, src, editedParticles, selectedParticle);
      cv.imshow(resultCanvasRef.current, output);
      src.delete();
      output.delete();
    } catch (error) {
      console.error("Error redrawing particles:", error);
    }
  };

  // Add this function to manually add a particle
  const addParticle = () => {
    if (!editMode || !resultCanvasRef.current) return;
    
    const canvas = resultCanvasRef.current;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    const newId = Math.max(...editedParticles.map(p => p.id), 0) + 10;
    const newParticle = {
      id: newId,
      x: Math.round(centerX),
      y: Math.round(centerY),
      radius: 20,
      diameter: 40,
      area: Math.round(Math.PI * 20 * 20)
    };
    
    const updatedParticles = [...editedParticles, newParticle];
    setEditedParticles(updatedParticles);
    setSelectedParticle(newParticle);
    
    redrawParticles();
  };

  // Add this function to delete a particle
  const deleteSelectedParticle = () => {
    if (!editMode || !selectedParticle) return;
    
    const updatedParticles = editedParticles.filter(p => p.id !== selectedParticle.id);
    setEditedParticles(updatedParticles);
    setSelectedParticle(null);
    
    redrawParticles();
  };

  // Add this function to adjust particle diameter
  const adjustParticleDiameter = (amount) => {
    if (!editMode || !selectedParticle) return;
    
    setEditedParticles(particles => particles.map(p => {
      if (p.id === selectedParticle.id) {
        const newRadius = Math.max(5, p.radius + amount);
        return {
          ...p,
          radius: newRadius,
          diameter: newRadius * 2,
          area: Math.round(Math.PI * newRadius * newRadius)
        };
      }
      return p;
    }));
    
    // Update the selected particle
    const updatedParticle = editedParticles.find(p => p.id === selectedParticle.id);
    if (updatedParticle) {
      setSelectedParticle(updatedParticle);
    }
    
    redrawParticles();
  };

  // Add this function to handle ID input changes
  const handleIdInputChange = (e) => {
    setIdInput(e.target.value);
  };

  // Add this function to select particle by ID
  const selectParticleById = () => {
    if (!idInput) return;
    
    const id = parseInt(idInput, 10);
    if (isNaN(id)) {
      alert('Please enter a valid ID number');
      return;
    }
    
    const particle = editedParticles.find(p => p.id === id);
    if (particle) {
      setSelectedParticle(particle);
      
      // If we're zoomed in, center the view on the selected particle
      if (zoom > 1 && resultCanvasRef.current) {
        const canvas = resultCanvasRef.current;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        // Calculate position to center the particle
        setViewPosition({
          x: centerX - (particle.x * zoom),
          y: centerY - (particle.y * zoom)
        });
      }
      
      // Highlight the particle
      redrawParticles();
      
      // Clear the input
      setIdInput('');
    } else {
      alert(`No particle found with ID ${id}`);
    }
  };

  // Add a keyboard event handler to allow pressing Enter to select
  const handleIdInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      selectParticleById();
    }
  };

  // Update the handleWheel function to reduce zoom sensitivity
  const handleWheel = (e) => {
    e.preventDefault();
    
    // Reduce the zoom sensitivity by applying a factor
    const zoomSensitivity = 0.05; // Lower value = less sensitive
    
    // Calculate the zoom delta with reduced sensitivity
    const delta = e.deltaY > 0 ? -zoomSensitivity : zoomSensitivity;
    const newZoom = Math.max(1, Math.min(10, zoom + delta));
    
    if (newZoom !== zoom) {
      // Calculate mouse position relative to the container
      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate the point on the image that's under the mouse
      const imageX = (mouseX - viewPosition.x) / zoom;
      const imageY = (mouseY - viewPosition.y) / zoom;
      
      // Calculate new view position to keep the point under the mouse
      const newViewX = mouseX - imageX * newZoom;
      const newViewY = mouseY - imageY * newZoom;
      
      setZoom(newZoom);
      setViewPosition({
        x: newViewX,
        y: newViewY
      });
    }
  }; // Make sure this closing brace is here

  // Update the results summary section with inline calculation
  const calculateAverageDiameter = () => {
    if (editedParticles.length === 0) return 0;
    
    const sum = editedParticles.reduce((total, particle) => total + particle.diameter, 0);
    return sum / editedParticles.length;
  };

  // Then, in your component, add this state variable or computed value
  const averageDiameter = calculateAverageDiameter();

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">SEM Particle Detector</h1>
      
      {/* OpenCV Loading Status */}
      {loadingStatus !== 'loaded' && loadingStatus !== 'forced' && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-bold">OpenCV Status: {loadingStatus}</p>
              <p>
                {loadingStatus === 'loading' && "Loading OpenCV.js..."}
                {loadingStatus === 'initializing' && "Initializing OpenCV.js..."}
                {loadingStatus === 'failed' && "Failed to load OpenCV.js."}
              </p>
            </div>
            {(loadingStatus === 'failed' || loadingStatus === 'initializing') && (
              <button 
                onClick={forceEnable}
                className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded"
              >
                Continue Anyway
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Image Upload Section */}
      <div className="bg-white p-4 rounded shadow mb-4">
        <h2 className="text-lg font-semibold mb-2">Upload SEM Image</h2>
        <div 
          {...getRootProps()} 
          className="border-2 border-dashed border-gray-300 rounded p-4 text-center cursor-pointer"
        >
          <input {...getInputProps()} />
          <p className="text-gray-500">Drag and drop an SEM image here, or click to select a file</p>
        </div>
      </div>
      
      {/* Detection Parameters Section */}
      {image && (
        <div className="bg-white p-4 rounded shadow mb-4">
          <h2 className="text-lg font-semibold mb-2">Detection Parameters</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Scale Calibration */}
            <div className="col-span-2">
              <h3 className="font-medium mb-2">Scale Calibration</h3>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Known Distance (pixels)
                  </label>
                  <input
                    type="number"
                    name="pixels"
                    value={scaleInput.pixels}
                    onChange={handleScaleInputChange}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="1"
                    step="1"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Actual Size (µm)
                  </label>
                  <input
                    type="number"
                    name="micrometers"
                    value={scaleInput.micrometers}
                    onChange={handleScaleInputChange}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="0.01"
                    step="0.01"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Scale Ratio
                  </label>
                  <div className="p-2 bg-gray-100 rounded">
                    {scaleRatio.toFixed(4)} µm/pixel
                  </div>
                </div>
              </div>
              
              {/* Add an example calculation to help users verify */}
              <div className="mt-2 text-sm text-gray-600">
                <p>Example: For {scaleInput.micrometers} µm across {scaleInput.pixels} pixels, the scale is {scaleRatio.toFixed(4)} µm/pixel</p>
                <p>A 100 pixel particle would be {(100 * scaleRatio).toFixed(2)} µm in diameter</p>
              </div>
            </div>
            
            {/* Min Radius */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Min Radius (px)
              </label>
              <input
                type="range"
                min="1"
                max="50"
                value={detectionParams.minRadius}
                onChange={(e) => handleParamChange('minRadius', e.target.value)}
                className="w-full"
              />
              <span className="text-sm text-gray-500">{detectionParams.minRadius}px</span>
            </div>
            
            {/* Max Radius */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Max Radius (px)
              </label>
              <input
                type="range"
                min="10"
                max="100"
                value={detectionParams.maxRadius}
                onChange={(e) => handleParamChange('maxRadius', e.target.value)}
                className="w-full"
              />
              <span className="text-sm text-gray-500">{detectionParams.maxRadius}px</span>
            </div>
            
            {/* Threshold */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Threshold
              </label>
              <input
                type="range"
                min="1"
                max="100"
                value={detectionParams.threshold}
                onChange={(e) => handleParamChange('threshold', e.target.value)}
                className="w-full"
              />
              <span className="text-sm text-gray-500">{detectionParams.threshold}</span>
            </div>
            
            {/* Min Area */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Min Area
              </label>
              <input
                type="range"
                min="0"
                max="500"
                value={detectionParams.minArea}
                onChange={(e) => handleParamChange('minArea', e.target.value)}
                className="w-full"
              />
              <span className="text-sm text-gray-500">{detectionParams.minArea}px²</span>
            </div>
          </div>
          
          <button
            onClick={processImage}
            disabled={isProcessing || (!isLoaded && loadingStatus !== 'forced')}
            className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {isProcessing ? 'Processing...' : 'Detect Particles'}
          </button>
        </div>
      )}
      
      {/* Add zoom controls */}
      {image && (
        <div className="bg-white p-4 rounded shadow mb-4">
          <h2 className="text-lg font-semibold mb-2">Zoom Controls</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm">1x</span>
            <input
              type="range"
              min="1"
              max="5"
              step="0.1"
              value={zoom}
              onChange={handleZoomChange}
              className="flex-grow"
            />
            <span className="text-sm">5x</span>
            <span className="ml-2 font-medium">{zoom.toFixed(1)}x</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Drag to pan when zoomed in</p>
        </div>
      )}
      
      {/* Add edit mode toggle and controls */}
      {particles.length > 0 && (
        <div className="bg-white p-4 rounded shadow mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Particle Editor</h2>
            <button
              onClick={toggleEditMode}
              className={`px-4 py-2 rounded ${
                editMode ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
              } text-white`}
            >
              {editMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
            </button>
          </div>
          
          {editMode && (
            <div className="space-y-4">
              {/* Add ID selection input */}
              <div className="flex items-center gap-2">
                <div className="flex-grow">
                  <label htmlFor="particle-id" className="block text-sm font-medium text-gray-700 mb-1">
                    Select Particle by ID
                  </label>
                  <div className="flex">
                    <input
                      id="particle-id"
                      type="text"
                      value={idInput}
                      onChange={handleIdInputChange}
                      onKeyDown={handleIdInputKeyDown}
                      placeholder="Enter ID number"
                      className="flex-grow p-2 border border-gray-300 rounded-l"
                    />
                    <button
                      onClick={selectParticleById}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-r"
                    >
                      Select
                    </button>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={addParticle}
                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                  >
                    Add Particle
                  </button>
                  <button
                    onClick={deleteSelectedParticle}
                    disabled={!selectedParticle}
                    className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded disabled:bg-gray-400"
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
              
              {/* Quick ID selection buttons */}
              {editedParticles.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quick Select
                  </label>
                  <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                    {editedParticles.map(particle => (
                      <button
                        key={particle.id}
                        onClick={() => handleParticleSelect(particle.id)}
                        className={`px-2 py-1 text-sm rounded ${
                          selectedParticle && selectedParticle.id === particle.id
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                        }`}
                      >
                        ID {particle.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {selectedParticle && (
                <div className="bg-gray-100 p-4 rounded">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-medium">
                      Selected Particle: ID {selectedParticle.id}
                    </h3>
                    <button
                      onClick={() => setSelectedParticle(null)}
                      className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-3 py-1 rounded text-sm"
                    >
                      Exit Selection
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-2">
                    <div>
                      <p className="text-sm text-gray-600">Position</p>
                      <p>({selectedParticle.x}, {selectedParticle.y})</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Diameter</p>
                      <p>{selectedParticle.diameter}px ({(selectedParticle.diameter * scaleRatio).toFixed(3)} µm)</p>
                    </div>
                  </div>
                  
                  <div className="mt-2">
                    <p className="text-sm font-medium mb-1">Adjust Diameter</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustParticleDiameter(-1)}
                        className="bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
                      >
                        -1px
                      </button>
                      <button
                        onClick={() => adjustParticleDiameter(-5)}
                        className="bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
                      >
                        -5px
                      </button>
                      <button
                        onClick={() => adjustParticleDiameter(1)}
                        className="bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
                      >
                        +1px
                      </button>
                      <button
                        onClick={() => adjustParticleDiameter(5)}
                        className="bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
                      >
                        +5px
                      </button>
                    </div>
                  </div>
                  
                  <p className="text-xs text-gray-500 mt-2">
                    Drag to move particle, drag edge to resize
                  </p>
                </div>
              )}
              
              <div className="text-sm text-gray-600 mt-2">
                <p>Scale calibration allows you to convert pixel measurements to micrometers (µm).</p>
                <p>Enter the known distance in pixels and the corresponding size in micrometers.</p>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Image Display Section with zoom functionality */}
      {image && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Original Image */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">Original Image</h2>
            <div 
              className="relative bg-gray-100 overflow-hidden h-[600px]"
              onMouseDown={(e) => handleMouseDown(e)}
              style={{ cursor: zoom > 1 ? 'move' : 'default' }}
            >
              <canvas 
                ref={canvasRef} 
                className="max-w-full h-auto transform-origin-center"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  position: 'relative',
                  left: `${viewPosition.x}px`,
                  top: `${viewPosition.y}px`
                }}
              />
              <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                {zoom.toFixed(1)}x
              </div>
            </div>
          </div>
          
          {/* Processed Image with editing capabilities */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">
              Processed Image
              {editMode && <span className="ml-2 text-sm text-red-500">(Edit Mode)</span>}
            </h2>
            <div 
              ref={imageContainerRef}
              className={`relative bg-gray-100 overflow-hidden h-[600px] ${editMode ? 'edit-mode' : ''} ${isDragging ? 'cursor-grabbing' : ''}`}
              onMouseDown={editMode ? handleCanvasMouseDown : (e) => handleMouseDown(e, imageContainerRef)}
              onMouseMove={editMode ? handleCanvasMouseMove : handleMouseMove}
              onMouseUp={editMode ? handleCanvasMouseUp : handleMouseUp}
              onMouseLeave={editMode ? handleCanvasMouseLeave : handleMouseUp}
              onWheel={handleWheel}
            >
              <canvas 
                ref={resultCanvasRef} 
                className="max-w-none h-auto"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  position: 'absolute',
                  left: `${viewPosition.x}px`,
                  top: `${viewPosition.y}px`
                }}
              />
              
              {/* Add a clear mode toggle */}
              {editMode && zoom > 1 && (
                <div className="mode-toggle">
                  <button
                    onClick={() => {
                      setInteractionMode('edit');
                      setIsMoving(false);
                      setIsResizing(false);
                    }}
                    className={interactionMode === 'edit' ? 'active' : ''}
                  >
                    Edit Mode
                  </button>
                  <button
                    onClick={() => {
                      setInteractionMode('pan');
                      setIsMoving(false);
                      setIsResizing(false);
                    }}
                    className={interactionMode === 'pan' ? 'active' : ''}
                  >
                    Pan Mode
                  </button>
                </div>
              )}
              
              {/* Status indicator */}
              {editMode && (
                <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                  {zoom.toFixed(1)}x • 
                  {interactionMode === 'edit' ? 'Edit Mode' : 'Pan Mode'}
                  {selectedParticle && ` • Particle ${selectedParticle.id}`}
                  {isMoving && ' (Moving)'}
                  {isResizing && ' (Resizing)'}
                </div>
              )}
              
              {/* Add a floating exit selection button when a particle is selected */}
              {editMode && selectedParticle && (
                <button
                  onClick={() => {
                    setSelectedParticle(null);
                    setIsMoving(false);
                    setIsResizing(false);
                  }}
                  className="absolute top-2 right-2 bg-white bg-opacity-80 text-gray-800 text-xs px-2 py-1 rounded border border-gray-300 hover:bg-opacity-100"
                >
                  Exit Selection
                </button>
              )}

              {editMode && selectedParticle && (isMoving || isResizing) && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-70 text-white text-xs px-3 py-1 rounded">
                  {isMoving ? 'Moving Particle' : 'Resizing Particle'} - Click to drop
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Results Section - update to show edited particles */}
      {particles.length > 0 && (
        <div className="bg-white p-4 rounded shadow">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">
              Detected Particles ({editMode ? editedParticles.length : particles.length})
              {editMode && <span className="ml-2 text-sm text-red-500">(Editing)</span>}
            </h2>
            <button
              onClick={exportResults}
              className="bg-green-500 text-white py-1 px-3 rounded hover:bg-green-600"
            >
              Export CSV
            </button>
          </div>
          
          <div className="results-summary mb-4">
            <p>Total particles: {particles.length}</p>
            {particles.length > 0 && (
              <p>
                Average diameter: {(particles.reduce((sum, p) => sum + p.diameter, 0) / particles.length).toFixed(2)} pixels 
                ({((particles.reduce((sum, p) => sum + p.diameter, 0) / particles.length) * scaleRatio).toFixed(3)} µm)
              </p>
            )}
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="p-2 text-left">ID</th>
                  <th className="p-2 text-left">X</th>
                  <th className="p-2 text-left">Y</th>
                  <th className="p-2 text-left">Diameter (px)</th>
                  <th className="p-2 text-left">Diameter (µm)</th>
                </tr>
              </thead>
              <tbody>
                {editedParticles.map((particle) => (
                  <tr 
                    key={particle.id}
                    className={selectedParticle && selectedParticle.id === particle.id ? 'bg-blue-50' : ''}
                    onClick={() => editMode && handleParticleSelect(particle.id)}
                    style={{ cursor: editMode ? 'pointer' : 'default' }}
                  >
                    <td className="p-2">{particle.id}</td>
                    <td className="p-2">{particle.x}</td>
                    <td className="p-2">{particle.y}</td>
                    <td className="p-2">{particle.diameter}</td>
                    <td className="p-2">{(particle.diameter * scaleRatio).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Add pan sensitivity control */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Pan Sensitivity: {panSensitivity.toFixed(2)}
        </label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          value={panSensitivity}
          onChange={(e) => setPanSensitivity(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>
      
      {/* Add zoom sensitivity control */}
      <div className="bg-white p-4 rounded shadow mb-4">
        <h2 className="text-lg font-semibold mb-2">Navigation Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zoom Sensitivity: {zoomSensitivity.toFixed(2)}
            </label>
            <input
              type="range"
              min="0.01"
              max="0.2"
              step="0.01"
              value={zoomSensitivity}
              onChange={(e) => setZoomSensitivity(parseFloat(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Lower = smoother zooming</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pan Sensitivity: {panSensitivity.toFixed(2)}
            </label>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={panSensitivity}
              onChange={(e) => setPanSensitivity(parseFloat(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Lower = slower panning</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Wrap the App component with the OpenCvWrapper
function AppWithOpenCV() {
  return (
    <OpenCvWrapper>
      <App />
    </OpenCvWrapper>
  );
}

export default AppWithOpenCV;