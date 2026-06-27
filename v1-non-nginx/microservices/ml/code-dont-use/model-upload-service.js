const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

class ModelUploadService {
  constructor(mlServicePort = 3002) {
    this.mlServicePort = mlServicePort;
    this.tempDir = path.join(__dirname, 'temp');
    this.modelDir = path.join(__dirname, '..', '..', 'MODEL-ML', 'joblib');
    
    // Ensure directories exist
    for (const dir of [this.tempDir, this.modelDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async uploadModel(file, metadata, userId) {
    try {
      console.log(`${new Date().toISOString()}: [ModelUpload] Starting model upload process`);
      console.log(`${new Date().toISOString()}: [ModelUpload] File info:`, {
        originalname: file.originalname,
        size: file.size,
        path: file.path
      });
      
      // Define model name and prepare directory
      const modelName = file.originalname.replace('.joblib', '');
      const modelFolder = path.join(this.modelDir, modelName);
      
      if (!fs.existsSync(modelFolder)) {
        fs.mkdirSync(modelFolder, { recursive: true });
      }
      
      // Define target paths
      const modelFilePath = path.join(modelFolder, file.originalname);
      const txtFilePath = path.join(modelFolder, `${modelName}.txt`);
      
      // Get absolute paths for MongoDB
      const absoluteModelFilePath = `/var/www/html/HIBAH/MODEL-ML/joblib/${modelName}/${file.originalname}`;
      const absoluteTxtFilePath = `/var/www/html/HIBAH/MODEL-ML/joblib/${modelName}/${modelName}.txt`;
      
      console.log(`${new Date().toISOString()}: [ModelUpload] Copying file to ${modelFilePath}`);
      
      // Copy the file to the MODEL-ML directory
      fs.copyFileSync(file.path, modelFilePath);
      
      // Create metadata file with proper format (no key-value pairs, just values in order)
      // Format:
      // ObjectId
      // Name
      // Version
      // Description
      // Accuracy
      // FilePath
      
      // Generate a dummy ObjectId for now - will be replaced by MongoDB
      const dummyObjectId = new Date().getTime().toString(16).padStart(24, '0');
      
      const txtContent = [
        dummyObjectId,
        metadata.name || modelName,
        metadata.version || '1.0.0',
        metadata.description || 'Uploaded model',
        metadata.accuracy || '0.92',
        absoluteModelFilePath
      ].join('\n');
      
      fs.writeFileSync(txtFilePath, txtContent);
      console.log(`${new Date().toISOString()}: [ModelUpload] Created metadata file at ${txtFilePath}`);
      
      // Send request to ML service to register this model
      const mlUrl = `http://localhost:${this.mlServicePort}/register-model`;
      console.log(`${new Date().toISOString()}: [ModelUpload] Sending registration request to ML service: ${mlUrl}`);
      
      const modelData = {
        name: metadata.name || modelName,
        version: metadata.version || '1.0.0',
        description: metadata.description || 'Uploaded model',
        accuracy: parseFloat(metadata.accuracy) || 0.92,
        filePath: absoluteModelFilePath,
        txtPath: absoluteTxtFilePath,
        active: metadata.active === 'true' || metadata.active === true,
        createdBy: userId
      };
      
      // Send a direct JSON request to register the model
      const response = await fetch(mlUrl, {
        method: 'POST',
        body: JSON.stringify(modelData),
        headers: {
          'Content-Type': 'application/json',
          'user-id': userId
        }
      });
      
      if (!response.ok) {
        // If registration failed, try the old upload method as fallback
        console.log(`${new Date().toISOString()}: [ModelUpload] Registration failed, falling back to old method`);
        return this.uploadToMLService(modelFilePath, modelData, userId);
      }
      
      const result = await response.json();
      console.log(`${new Date().toISOString()}: [ModelUpload] Upload successful`);
      
      return result;
    } catch (error) {
      console.error(`${new Date().toISOString()}: [ModelUpload] Error:`, error.message);
      throw error;
    } finally {
      // Clean up temp file
      try {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
          console.log(`${new Date().toISOString()}: [ModelUpload] Cleaned up temp file`);
        }
      } catch (cleanupError) {
        console.error(`${new Date().toISOString()}: [ModelUpload] Cleanup error:`, cleanupError.message);
      }
    }
  }
  
  // Fallback method that uses the direct upload endpoint
  async uploadToMLService(filePath, metadata, userId) {
    try {
      console.log(`${new Date().toISOString()}: [ModelUpload] Using fallback method`);
      
      // Use the direct upload endpoint, providing file path information
      const uploadUrl = `http://localhost:${this.mlServicePort}/direct-upload`;
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: JSON.stringify({
          filePath,
          ...metadata
        }),
        headers: {
          'Content-Type': 'application/json',
          'user-id': userId
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to upload model to ML service');
      }
      
      const result = await response.json();
      console.log(`${new Date().toISOString()}: [ModelUpload] Fallback upload successful`);
      
      return result;
    } catch (error) {
      console.error(`${new Date().toISOString()}: [ModelUpload] Fallback error:`, error.message);
      throw error;
    }
  }
}

module.exports = ModelUploadService; 