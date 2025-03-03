import React, { useState, useEffect, createContext, useContext } from 'react';

// Create a context for OpenCV
export const OpenCvContext = createContext(null);

// Custom hook to use OpenCV
export const useOpenCv = () => useContext(OpenCvContext);

const OpenCvWrapper = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('loading');

  useEffect(() => {
    // Check if OpenCV is already loaded
    if (window.cv) {
      console.log('OpenCV.js is already loaded');
      setIsLoaded(true);
      setLoadingStatus('loaded');
      return;
    }

    // Function to run when OpenCV is ready
    window.onOpenCvReady = () => {
      console.log('OpenCV.js is ready');
      setIsLoaded(true);
      setLoadingStatus('loaded');
    };

    // If OpenCV script is not already in the document, add it
    if (!document.getElementById('opencv-script')) {
      const script = document.createElement('script');
      script.id = 'opencv-script';
      
      // Use a specific version that's known to work well
      script.src = 'https://docs.opencv.org/4.5.5/opencv.js';
      script.async = true;
      
      // Add a direct check for when OpenCV becomes available
      const checkOpenCv = setInterval(() => {
        if (window.cv) {
          clearInterval(checkOpenCv);
          console.log('OpenCV detected through interval check');
          setIsLoaded(true);
          setLoadingStatus('loaded');
        }
      }, 500);

      script.onload = () => {
        console.log('OpenCV.js script loaded, waiting for initialization');
        setLoadingStatus('initializing');
      };
      
      script.onerror = () => {
        console.error('Failed to load OpenCV.js from CDN');
        setLoadingStatus('failed');
        
        // Try loading from a different CDN as fallback
        const fallbackScript = document.createElement('script');
        fallbackScript.id = 'opencv-script-fallback';
        fallbackScript.src = 'https://cdn.jsdelivr.net/npm/opencv.js@1.2.1/opencv.min.js';
        fallbackScript.async = true;
        document.body.appendChild(fallbackScript);
      };
      
      document.body.appendChild(script);
      
      // Set a timeout to force enable the button if OpenCV takes too long
      setTimeout(() => {
        if (!isLoaded) {
          console.warn('OpenCV loading timeout - forcing enable');
          setIsLoaded(true);
          setLoadingStatus('forced');
        }
      }, 10000); // 10 seconds timeout
    }

    // Cleanup function
    return () => {
      window.onOpenCvReady = null;
    };
  }, [isLoaded]);

  return (
    <OpenCvContext.Provider value={{ 
      cv: window.cv, 
      isLoaded, 
      loadingStatus,
      // Force enable functionality even if OpenCV isn't fully loaded
      forceEnable: () => {
        setIsLoaded(true);
        setLoadingStatus('forced');
      }
    }}>
      {children}
    </OpenCvContext.Provider>
  );
};

export default OpenCvWrapper;