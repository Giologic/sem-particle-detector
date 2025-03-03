import React, { useState, useRef, useEffect } from 'react';
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
    micrometers: 80,
    pixels: 307
  });
  const [scaleRatio, setScaleRatio] = useState(0.8); // nm per pixel
  const [detectionParams, setDetectionParams] = useState({
    minRadius: 9,
    maxRadius: 38,
    threshold: 27,
    minArea: 30
  });
  const [isProcessing, setIsProcessing] = useState(false);
  
  const canvasRef = useRef(null);
  const resultCanvasRef = useRef(null);
  const { cv, isLoaded, loadingStatus, forceEnable } = useOpenCv();

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

  // Add a function to calculate the scale ratio
  const calculateScaleRatio = () => {
    if (scaleInput.pixels > 0) {
      // Convert micrometers to nanometers (1 μm = 1000 nm)
      const nanometers = scaleInput.micrometers * 1000;
      const ratio = nanometers / scaleInput.pixels;
      setScaleRatio(ratio);
      return ratio;
    }
    return scaleRatio;
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
        id: (index + 1) * 10 // ID increments by 10 as shown in the image
      }));
      
      setParticles(particlesWithIds);
      
      // Draw particles on the image
      const output = drawParticles(cvInstance, src, particlesWithIds);
      
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
    if (particles.length === 0) return;
    
    let csvContent = "ID,POSITION,DIAMETER (PX),DIAMETER (NM),AREA (PX²)\n";
    
    particles.forEach(particle => {
      csvContent += `${particle.id},(${particle.x}, ${particle.y}),${particle.diameter},${(particle.diameter * scaleRatio).toFixed(2)},${particle.area}\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'particle_data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
              <label className="block text-sm font-medium mb-1">
                Scale Calibration
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Micrometers (μm)
                  </label>
                  <input
                    type="number"
                    name="micrometers"
                    value={scaleInput.micrometers}
                    onChange={handleScaleInputChange}
                    onBlur={calculateScaleRatio}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="0.001"
                    step="0.001"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Pixels (px)
                  </label>
                  <input
                    type="number"
                    name="pixels"
                    value={scaleInput.pixels}
                    onChange={handleScaleInputChange}
                    onBlur={calculateScaleRatio}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="1"
                  />
                </div>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Scale ratio: {scaleRatio.toFixed(2)} nm/pixel
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
      
      {/* Image Display Section */}
      {image && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Original Image */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">Original Image</h2>
            <div className="relative bg-gray-100 overflow-hidden">
              <canvas ref={canvasRef} className="max-w-full h-auto" />
            </div>
          </div>
          
          {/* Processed Image */}
          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">Processed Image</h2>
            <div className="relative bg-gray-100 overflow-hidden">
              <canvas ref={resultCanvasRef} className="max-w-full h-auto" />
            </div>
          </div>
        </div>
      )}
      
      {/* Results Section */}
      {particles.length > 0 && (
        <div className="bg-white p-4 rounded shadow">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Detected Particles ({particles.length})</h2>
            <button
              onClick={exportResults}
              className="bg-green-500 text-white py-1 px-3 rounded hover:bg-green-600"
            >
              Export CSV
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Position</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Diameter (px)</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Diameter (nm)</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Area (px²)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {particles.map((particle) => (
                  <tr key={particle.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{particle.id}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">({particle.x}, {particle.y})</td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{particle.diameter}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{(particle.diameter * scaleRatio).toFixed(2)}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{particle.area}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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