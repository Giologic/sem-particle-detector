// Helper functions for particle detection using OpenCV.js

export const detectParticles = (cv, imgMat, params) => {
    const { minRadius, maxRadius, threshold1, threshold2 } = params;
    
    try {
      // Convert to grayscale if needed
      let gray = new cv.Mat();
      if (imgMat.channels() === 3 || imgMat.channels() === 4) {
        if (imgMat.channels() === 4) {
          cv.cvtColor(imgMat, gray, cv.COLOR_RGBA2GRAY);
        } else {
          cv.cvtColor(imgMat, gray, cv.COLOR_RGB2GRAY);
        }
      } else {
        imgMat.copyTo(gray);
      }
      
      // Apply Gaussian blur to reduce noise
      let blurred = new cv.Mat();
      let ksize = new cv.Size(5, 5);
      cv.GaussianBlur(gray, blurred, ksize, 0);
      
      // Find circles using Hough transform
      let circles = new cv.Mat();
      
      // HoughCircles parameters - adjusted for better detection
      cv.HoughCircles(
        blurred,
        circles,
        cv.HOUGH_GRADIENT,
        1,                // dp
        minRadius * 0.5,  // minDist - reduced to detect more circles
        threshold1,       // param1
        threshold2,       // param2 - use directly, not divided
        minRadius,
        maxRadius
      );
      
      console.log(`Detected ${circles.cols} circles`);
      
      // Process detected circles
      const particles = [];
      for (let i = 0; i < circles.cols; ++i) {
        const x = Math.round(circles.data32F[i * 3]);
        const y = Math.round(circles.data32F[i * 3 + 1]);
        const radius = Math.round(circles.data32F[i * 3 + 2]);
        const diameter = radius * 2;
        
        // Calculate approximate area
        const area = Math.PI * radius * radius;
        
        particles.push({
          id: i + 1,
          x: x,
          y: y,
          radius: radius,
          diameter: diameter,
          area: Math.round(area)
        });
      }
      
      // Clean up
      gray.delete();
      blurred.delete();
      circles.delete();
      
      return particles;
    } catch (error) {
      console.error("Error in detectParticles:", error);
      throw error;
    }
  };
  
  export const drawParticles = (cv, imgMat, particles, color = [0, 255, 0, 255]) => {
    try {
      // Clone the input image to avoid modifying it
      const output = imgMat.clone();
      const colorScalar = new cv.Scalar(...color);
      
      // Log the number of particles being drawn
      console.log(`Drawing ${particles.length} particles`);
      
      // Draw each particle
      particles.forEach(particle => {
        // Check if coordinates are within image bounds
        if (particle.x >= 0 && particle.x < output.cols && 
            particle.y >= 0 && particle.y < output.rows) {
          
          const center = new cv.Point(particle.x, particle.y);
          
          // Draw circle outline
          cv.circle(output, center, particle.radius, colorScalar, 2);
          
          // Draw center point
          cv.circle(output, center, 2, colorScalar, -1);
          
          // Add text with diameter
          const text = `${particle.diameter}px`;
          const textOrg = new cv.Point(
            Math.max(particle.x - 20, 0), 
            Math.max(particle.y - particle.radius - 5, 15)
          );
          cv.putText(output, text, textOrg, cv.FONT_HERSHEY_SIMPLEX, 0.5, colorScalar, 1);
        }
      });
      
      return output;
    } catch (error) {
      console.error("Error in drawParticles:", error);
      throw error;
    }
  };

export const drawParticlesWithIds = (cv, imgMat, particles, color = [0, 255, 0, 255]) => {
  try {
    // Clone the input image to avoid modifying it
    const output = imgMat.clone();
    const colorScalar = new cv.Scalar(...color);
    
    // Draw each particle
    particles.forEach(particle => {
      if (particle.x >= 0 && particle.x < output.cols && 
          particle.y >= 0 && particle.y < output.rows) {
        
        const center = new cv.Point(particle.x, particle.y);
        
        // Draw circle outline
        cv.circle(output, center, particle.radius, colorScalar, 2);
        
        // Draw center point
        cv.circle(output, center, 2, colorScalar, -1);
        
        // Add text with ID instead of diameter
        const text = `${particle.id}`;
        const textOrg = new cv.Point(
          Math.max(particle.x - 10, 0), 
          Math.max(particle.y - particle.radius - 5, 15)
        );
        cv.putText(output, text, textOrg, cv.FONT_HERSHEY_SIMPLEX, 0.5, colorScalar, 1);
      }
    });
    
    return output;
  } catch (error) {
    console.error("Error in drawParticlesWithIds:", error);
    throw error;
  }
};