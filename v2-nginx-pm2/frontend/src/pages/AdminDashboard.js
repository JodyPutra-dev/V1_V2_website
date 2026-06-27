import React, { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Card, Button, Table, Form, Modal, Alert, Tabs, Tab, Spinner } from 'react-bootstrap';
import { adminAPI, mlAPI } from '../services/api';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import config from '../config';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const AdminDashboard = () => {
  // Users management state
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create', 'edit', 'password'
  
  // Add/Edit user form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'user'
  });
  
  // ML model management state
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelFile, setModelFile] = useState(null);
  
  // Active tab tracking
  const [activeTab, setActiveTab] = useState('models');
  
  // Model form state
  const [modelFormData, setModelFormData] = useState({
    name: '',
    description: '',
    version: '',
    accuracy: 0.92,
    active: true
  });
  
  // Analytics state
  const [siteStats, setSiteStats] = useState({
    totalUsers: 0,
    totalAdmins: 0,
    newUsersThisMonth: 0,
    activeUsersToday: 0,
    userRegistrations: []
  });
  
  // Separate loading state for analytics refresh
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  
  // Mock visit data for chart
  const [visitData, setVisitData] = useState({
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'User Registrations',
        data: [0, 0, 0, 0, 0, 0],
        borderColor: config.colorTheme === 'blue' ? '#3B82F6' : '#F97316', // Use actual color values
        backgroundColor: config.colorTheme === 'blue' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(249, 115, 22, 0.2)',
        tension: 0.3
      }
    ]
  });
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Define chart data generation functions before useCallback
  const generateUserRegistrationData = useCallback((usersArray) => {
    // Get real user registration data from the users array
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentDate = new Date();
    
    // Initialize counts for the last 6 months
    const monthlyCounts = Array(6).fill(0);
    const labels = [];
    
    // Get last 6 months labels
    for (let i = 5; i >= 0; i--) {
      const monthIndex = (currentDate.getMonth() - i + 12) % 12;
      labels.push(months[monthIndex]);
    }
    
    console.log('AdminDashboard: Processing user registration data for charts');
    console.log(`AdminDashboard: Found ${usersArray?.length || 0} users to analyze`);
    
    // Sort users by registration date (oldest first)
    let sortedUsers = [];
    if (usersArray && Array.isArray(usersArray) && usersArray.length > 0) {
      sortedUsers = [...usersArray].filter(user => user.createdAt);
      
      // Sort by creation date (oldest first)
      sortedUsers.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateA - dateB;
      });
    }
    
    // Track users who registered before our chart time window
    let userCount = 0;
    
    // Count all users registered before the start of our 6-month window
    if (sortedUsers.length > 0) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); // 6 months ago (including current month)
      sixMonthsAgo.setDate(1); // First day of the month
      sixMonthsAgo.setHours(0, 0, 0, 0); // Start of the day
      
      // Count users registered before our chart window
      sortedUsers.forEach(user => {
        const registrationDate = new Date(user.createdAt);
        if (registrationDate < sixMonthsAgo) {
          userCount++;
        }
      });
      
      console.log(`AdminDashboard: ${userCount} users registered before the 6-month window`);
      
      // Start the first month's count with users registered before the window
      monthlyCounts[0] = userCount;
      
      // Now count and accumulate for each month in our 6-month window
      sortedUsers.forEach(user => {
        const registrationDate = new Date(user.createdAt);
        
        // Skip users registered before our time window (already counted)
        if (registrationDate < sixMonthsAgo) {
          return;
        }
        
        const monthDiff = (currentDate.getMonth() - registrationDate.getMonth() + 12) % 12;
        const yearDiff = currentDate.getFullYear() - registrationDate.getFullYear();
        
        // Check if registration was in the last 6 months
        if ((yearDiff === 0 && monthDiff < 6) || 
            (yearDiff === 1 && monthDiff < 6 && currentDate.getMonth() < registrationDate.getMonth())) {
          
          // The position in our array for this month
          const monthPosition = 5 - monthDiff;
          
          // Increment count for this month and all future months
          for (let i = monthPosition; i < 6; i++) {
            monthlyCounts[i]++;
          }
        }
      });
    }
    
    console.log('AdminDashboard: Final cumulative monthly counts:', monthlyCounts);
    
    return {
      labels,
      datasets: [
        {
          label: 'Total User Registrations',
          data: monthlyCounts,
          borderColor: config.colorTheme === 'blue' ? '#3B82F6' : '#F97316', // Use actual color values
          backgroundColor: config.colorTheme === 'blue' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(249, 115, 22, 0.2)',
          tension: 0.3
        }
      ]
    };
  }, []);
  
  const generateChartDataFromStats = useCallback((monthlyRegistrations) => {
    // Implementation of generateChartDataFromStats function
    // This function should return the chart data based on the monthlyRegistrations
    // For now, we'll use the existing generateUserRegistrationData function
    return generateUserRegistrationData(monthlyRegistrations);
  }, [generateUserRegistrationData]);
  
  // Define fetchData using useCallback to prevent recreation on each render
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      console.log('AdminDashboard: Starting data fetch');
      
      // Check that we have a token
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('AdminDashboard: No authentication token found');
        setError('Authentication required. Please log in again.');
        setLoading(false);
        // Redirect to login page immediately
        window.location.href = '/login';
        return;
      }
      console.log('AdminDashboard: Auth token verified');
      
      // Fetch all users
      console.log('AdminDashboard: Fetching users...');
      try {
        const response = await adminAPI.getUsers();
        console.log('AdminDashboard: Users response:', response);
        
        if (response.data && response.data.data) {
          const userData = response.data.data;
          setUsers(userData);
          
          // Generate chart data from user data
          const registrationData = generateUserRegistrationData(userData);
          setVisitData(registrationData);
        } else {
          console.warn('AdminDashboard: Invalid users response format');
          setUsers([]);
        }
      } catch (userError) {
        console.error('AdminDashboard: Error fetching users:', userError);
        setError('Failed to fetch users. ' + (userError.response?.data?.message || userError.message));
      }
      
      // Fetch system stats
      console.log('AdminDashboard: Fetching stats...');
      try {
        const statsResponse = await adminAPI.getStats();
        console.log('AdminDashboard: Stats response:', statsResponse);
        
        // If we have stats data in the expected format
        if (statsResponse.data && statsResponse.data.data) {
          const statsData = statsResponse.data.data;
          const userStats = statsData.users || {};
          setSiteStats({
            totalUsers: userStats.totalCount || 0,
            totalAdmins: userStats.adminCount || 0,
            newUsersThisMonth: userStats.recentUsers || 0,
            activeUsersToday: userStats.activeUsers || 0,
            userRegistrations: userStats.monthlyRegistrations || []
          });
          
          // If we have registration data, use it for the chart
          if (userStats.monthlyRegistrations && userStats.monthlyRegistrations.length > 0) {
            const chartData = generateChartDataFromStats(userStats.monthlyRegistrations);
            setVisitData(chartData);
          }
        } else {
          console.warn('AdminDashboard: Stats response missing data');
        }
      } catch (statsError) {
        console.error('AdminDashboard: Error fetching stats:', statsError);
        // Don't fail completely if stats fetch fails
      }
      
      // Fetch ML models
      console.log('AdminDashboard: Fetching ML models...');
      try {
        const modelsResponse = await mlAPI.getModels();
        console.log('AdminDashboard: ML models response:', modelsResponse);
        
        // Handle different response formats
        let modelsList = [];
        
        if (modelsResponse && modelsResponse.data) {
          if (Array.isArray(modelsResponse.data)) {
            // Direct array
            modelsList = modelsResponse.data;
          } else if (modelsResponse.data.data && Array.isArray(modelsResponse.data.data)) {
            // Nested data property with array
            modelsList = modelsResponse.data.data;
          } else if (modelsResponse.data.availableModels) {
            // Format from original ML service
            const activeModelName = modelsResponse.data.activeModel;
            modelsList = [{
              id: 'default-model',
              name: 'Kidney Stone Detection Model',
              version: '1.0',
              accuracy: 0.92,
              createdAt: new Date().toISOString(),
              active: activeModelName === 'joblib'
            }];
          } else if (typeof modelsResponse.data === 'object') {
            // Single model object
            modelsList = [modelsResponse.data];
          } else {
            console.warn('AdminDashboard: Unexpected models response format:', modelsResponse.data);
            
            // Fallback to a default model
            modelsList = [{
              id: 'default-model',
              name: 'Kidney Stone Detection Model',
              version: '1.0',
              accuracy: 0.92,
              createdAt: new Date().toISOString(),
              active: true
            }];
          }
        } else {
          console.warn('AdminDashboard: Empty or invalid models response:', modelsResponse);
          
          // Use default model as fallback
          modelsList = [{
            id: 'default-model',
            name: 'Kidney Stone Detection Model',
            version: '1.0',
            accuracy: 0.92,
            createdAt: new Date().toISOString(),
            active: true
          }];
        }
        
        // Format accuracy as decimal if needed
        modelsList = modelsList.map(model => ({
          ...model,
          accuracy: typeof model.accuracy === 'string' ? 
            parseFloat(model.accuracy) : model.accuracy || 0.92
        }));
        
        console.log('AdminDashboard: Processed models list:', modelsList);
        setModels(modelsList);
      } catch (err) {
        console.error('AdminDashboard: Error fetching ML models:', err);
        setError('Failed to fetch ML models');
        
        // Set a default model as fallback
        setModels([{
          id: 'default-model',
          name: 'Kidney Stone Detection Model (Fallback)',
          version: '1.0',
          accuracy: 0.92,
          createdAt: new Date().toISOString(),
          active: true
        }]);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('AdminDashboard: Error:', error);
      setError('An error occurred while fetching data: ' + (error.response?.data?.message || error.message));
      setLoading(false);
    }
  }, [generateUserRegistrationData, generateChartDataFromStats]);  // Add the missing dependencies
  
  // Function to refresh all data
  const refreshData = () => {
    console.log('AdminDashboard: Refreshing all data');
    fetchData();
  };
  
  // Fetch data on component mount
  useEffect(() => {
    fetchData();
    
    // Check if there's a tab parameter in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam && ['users', 'models', 'analytics'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [fetchData]);
  
  // User form handlers
  const handleUserFormChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
  };
  
  const resetUserForm = () => {
    setFormData({
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: 'user'
    });
  };
  
  const openCreateUserModal = () => {
    resetUserForm();
    setModalMode('create');
    setShowUserModal(true);
  };
  
  const openEditUserModal = (user) => {
    setSelectedUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      confirmPassword: '',
      role: user.role
    });
    setModalMode('edit');
    setShowUserModal(true);
  };
  
  const openChangePasswordModal = (user) => {
    setSelectedUser(user);
    setModalMode('password');
    setShowUserModal(true);
  };
  
  const handleSubmitUser = async (e) => {
    e.preventDefault();
    
    try {
      if (modalMode === 'create') {
        // Validate form data
        if (formData.password !== formData.confirmPassword) {
          setError('Passwords do not match');
          return;
        }
        
        setLoading(true);
        console.log('Creating new user:', { ...formData, password: '[REDACTED]' });
        
        // Create new user through API
        const response = await adminAPI.createUser({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: formData.role
        });
        
        console.log('Create user API response:', response.data);
        
        if (response.data && response.data.success) {
          setSuccess('User created successfully');
          
          // Force refresh data from server
          setTimeout(() => {
            refreshData();
          }, 1000);
        } else {
          setError(response.data?.message || 'Failed to create user');
        }
        setLoading(false);
      } else if (modalMode === 'edit') {
        setLoading(true);
        console.log('Updating user:', { id: selectedUser._id, ...formData });
        
        try {
          // Call the API to update the user
          const response = await adminAPI.updateUser(selectedUser._id, {
            name: formData.name,
            email: formData.email,
            role: formData.role
          });
          
          console.log('Update user API response:', response.data);
          
          if (response.data && response.data.success) {
            setSuccess('User updated successfully');
            
            // Force refresh data from server
            setTimeout(() => {
              refreshData();
            }, 1000);
          } else {
            setError(response.data?.message || 'Failed to update user');
          }
        } catch (err) {
          console.error('Error updating user:', err);
          console.error('Error response:', err.response?.data);
          setError(err.response?.data?.message || 'Failed to update user');
        } finally {
          setLoading(false);
        }
      } else if (modalMode === 'password') {
        // Reset user password - calls the API endpoint we created
        setLoading(true);
        
        try {
          const response = await adminAPI.resetPassword(selectedUser._id);
          
          if (response.data.success) {
            setSuccess(
              `Password reset successful. An email with reset instructions has been sent to ${selectedUser.email}.
              
              The temporary password is: ${response.data.tempPassword}
              
              Note: The user should change this password after logging in.`
            );
            
            // Log the success for debugging
            console.log('Password reset successful:', response.data);
          } else {
            setError(response.data.message || 'Failed to reset password');
          }
        } catch (error) {
          setError(error.response?.data?.message || 'Failed to reset password');
          console.error('Password reset error:', error);
        } finally {
          setLoading(false);
        }
      }
      
      setShowUserModal(false);
      resetUserForm();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit user data');
      console.error(err);
      setLoading(false);
    }
  };
  
  const handleDeleteUser = async (userId) => {
    // Log the user ID for debugging
    console.log(`User ID to delete (raw value):`, userId);
    console.log(`User ID type:`, typeof userId);
    console.log(`User ID string representation:`, String(userId));
    
    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        setLoading(true);
        console.log(`Attempting to delete user with ID: ${userId}`);
        
        // Call the API to delete the user
        const response = await adminAPI.deleteUser(userId);
        
        console.log('Delete user API response:', response.data);
        
        if (response.data && response.data.success) {
          // Update local state after successful deletion
          const updatedUsers = users.filter(user => user._id !== userId);
          setUsers(updatedUsers);
          setSuccess('User deleted successfully');
          
          // Force refresh data from server
          setTimeout(() => {
            refreshData();
          }, 1000);
        } else {
          setError(response.data?.message || 'Failed to delete user');
        }
      } catch (err) {
        console.error('Error deleting user:', err);
        console.error('Error response:', err.response?.data);
        setError(err.response?.data?.message || 'Failed to delete user');
      } finally {
        setLoading(false);
      }
    }
  };
  
  // Model management handlers
  const handleModelFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setModelFormData({
      ...modelFormData,
      [name]: type === 'checkbox' ? checked : value
    });
  };
  
  const handleModelFileChange = (e) => {
    setModelFile(e.target.files[0]);
  };
  
  const openModelModal = (model = null) => {
    if (model) {
      setSelectedModel(model);
      setModelFormData({
        name: model.name || '',
        description: model.description || '',
        version: model.version || '1.0',
        accuracy: model.accuracy || 0.92,
        active: model.active === undefined ? true : model.active
      });
    } else {
      setSelectedModel(null);
      setModelFormData({
        name: '',
        description: '',
        version: '1.0',
        accuracy: 0.92,
        active: true
      });
    }
    setShowModelModal(true);
  };
  
  const handleUpdateModelDescription = async (modelId, description) => {
    try {
      console.log(`Updating model ${modelId} description`);
      setLoading(true);
      
      const response = await mlAPI.updateModelDescription(modelId, description);
      
      if (response.data && response.data.success) {
        // Update local state
        const updatedModels = models.map(model =>
          model.id === modelId ? { ...model, description } : model
        );
        setModels(updatedModels);
        setSuccess('Model description updated successfully');
      } else {
        setError('Failed to update model description');
      }
    } catch (err) {
      console.error('Error updating model description:', err);
      setError('Error updating model description: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };
  
  const handleUpdateModelAccuracy = async (modelId, accuracy) => {
    try {
      // Add debugging
      const parsedAccuracy = parseFloat(accuracy);
      console.log(`Updating model ${modelId} accuracy to ${accuracy}`);
      console.log(`Accuracy type: ${typeof accuracy}, Parsed value: ${parsedAccuracy}, Is between 0-1: ${parsedAccuracy >= 0 && parsedAccuracy <= 1}`);
      setLoading(true);
      
      // Ensure accuracy is a number between 0 and 1
      if (isNaN(parsedAccuracy) || parsedAccuracy < 0 || parsedAccuracy > 1) {
        // Convert to valid range if needed (divide by 100 if it appears to be a percentage)
        const adjustedAccuracy = parsedAccuracy > 1 ? parsedAccuracy / 100 : parsedAccuracy;
        if (adjustedAccuracy >= 0 && adjustedAccuracy <= 1) {
          console.log(`Adjusting accuracy from ${accuracy} to ${adjustedAccuracy}`);
          accuracy = adjustedAccuracy;
        } else {
          throw new Error('Accuracy must be a number between 0 and 1');
        }
      }
      
      const response = await mlAPI.updateModelAccuracy(modelId, accuracy);
      
      if (response.data && response.data.success) {
        // Update local state
        const updatedModels = models.map(model =>
          model.id === modelId ? { ...model, accuracy } : model
        );
        setModels(updatedModels);
        setSuccess('Model accuracy updated successfully');
      } else {
        setError('Failed to update model accuracy');
      }
    } catch (err) {
      console.error('Error updating model accuracy:', err);
      setError('Error updating model accuracy: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };
  
  const handleUpdateModelVersion = async (modelId, version) => {
    try {
      console.log(`Updating model ${modelId} version to ${version}`);
      setLoading(true);
      
      const response = await mlAPI.updateModelVersion(modelId, version);
      
      if (response.data && response.data.success) {
        // Update local state
        const updatedModels = models.map(model =>
          model.id === modelId ? { ...model, version } : model
        );
        setModels(updatedModels);
        setSuccess('Model version updated successfully');
      } else {
        setError('Failed to update model version');
      }
    } catch (err) {
      console.error('Error updating model version:', err);
      setError('Error updating model version: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };
  
  const handleSubmitModel = async (e) => {
    e.preventDefault();
    
    try {
      // Check if we're editing an existing model or creating a new one
      if (selectedModel) {
        // Editing existing model, no need for file upload
        console.log('Updating existing model:', selectedModel);
        console.log('Selected model ID properties:', {
          id: selectedModel.id,
          _id: selectedModel._id,
          objectId: selectedModel._id?.toString()
        });
        
        // Save the model name change if it has changed
        if (modelFormData.name !== selectedModel.name) {
          try {
            console.log('Updating model name from', selectedModel.name, 'to', modelFormData.name);
            await mlAPI.updateModelName(selectedModel._id?.toString() || selectedModel.id, modelFormData.name);
            console.log('Model name updated successfully');
          } catch (nameError) {
            console.error('Error updating model name:', nameError);
            setError('Failed to update model name: ' + (nameError.response?.data?.message || nameError.message));
            // Continue with other updates even if name update fails
          }
        }
        
        // Update description if changed
        if (modelFormData.description !== selectedModel.description) {
          try {
            console.log('Updating model description');
            await handleUpdateModelDescription(selectedModel._id?.toString() || selectedModel.id, modelFormData.description);
          } catch (descError) {
            console.error('Error updating model description:', descError);
            // Continue with other updates even if description update fails
          }
        }
        
        // Update accuracy if changed
        if (parseFloat(modelFormData.accuracy) !== parseFloat(selectedModel.accuracy)) {
          try {
            console.log('Updating model accuracy from', selectedModel.accuracy, 'to', modelFormData.accuracy);
            const modelId = selectedModel._id?.toString() || selectedModel.id;
            console.log('Using model ID for accuracy update:', modelId);
            await handleUpdateModelAccuracy(modelId, modelFormData.accuracy);
          } catch (accError) {
            console.error('Error updating model accuracy:', accError);
            // Continue with other updates even if accuracy update fails
          }
        }
        
        // Update version if changed
        if (modelFormData.version !== selectedModel.version) {
          try {
            console.log('Updating model version from', selectedModel.version, 'to', modelFormData.version);
            const modelId = selectedModel._id?.toString() || selectedModel.id;
            console.log('Using model ID for version update:', modelId);
            await handleUpdateModelVersion(modelId, modelFormData.version);
          } catch (versionError) {
            console.error('Error updating model version:', versionError);
            // Continue with other updates even if version update fails
          }
        }
        
        // Toggle active status if needed
        if (modelFormData.active !== selectedModel.active) {
          try {
            const modelId = selectedModel._id?.toString() || selectedModel.id;
            console.log('Using model ID for status update:', modelId);
            await toggleModelStatus(modelId);
          } catch (err) {
            console.error('Error toggling model status:', err);
            setError('Failed to update model status. ' + (err.response?.data?.message || err.message));
            return;
          }
        }
        
        // Update the local state with the new values
        const updatedModels = models.map(model => 
          model.id === selectedModel.id ? 
            {
              ...model, 
              name: modelFormData.name,
              description: modelFormData.description,
              accuracy: parseFloat(modelFormData.accuracy),
              active: modelFormData.active
            } : 
            model
        );
        
        setModels(updatedModels);
        setSuccess('Model updated successfully');
        setShowModelModal(false);
      } else {
        // New model with file upload
        console.log('Creating new model');
        
        if (!modelFile) {
          setError('Please select a model file');
          return;
        }
        
        // Create form data for file upload
        const formData = new FormData();
        
        // Directly append the file object
        formData.append('model', modelFile);
        
        // Add other form fields
        formData.append('name', modelFormData.name);
        formData.append('version', modelFormData.version);
        formData.append('description', modelFormData.description);
        formData.append('accuracy', modelFormData.accuracy);
        formData.append('active', modelFormData.active);
        
        // Log the form data contents for debugging
        console.log('Form data contents:');
        for (let pair of formData.entries()) {
          console.log(pair[0] + ': ' + (pair[1] instanceof File ? pair[1].name : pair[1]));
        }
        
        console.log('Uploading model with form data:', {
          name: modelFormData.name,
          version: modelFormData.version,
          description: modelFormData.description,
          accuracy: modelFormData.accuracy,
          active: modelFormData.active,
          file: modelFile.name,
          fileType: modelFile.type,
          fileSize: modelFile.size
        });
        
        // Set loading state
        setLoading(true);
        
        try {
          const response = await adminAPI.createModel(formData);
          
          if (response.data && response.data.success) {
            // First show success message
            setSuccess('New model uploaded successfully. Page will refresh automatically in a moment...');
            
            // Close the modal
            setShowModelModal(false);
            
            // Clean up file input
            setModelFile(null);
            
            // Add a slight delay before refreshing the page to ensure the backend has fully processed
            setTimeout(() => {
              console.log('Forcing complete page reload after successful model upload');
              // Navigate back to this page with the models tab active and a timestamp to force reload
              window.location.href = `${window.location.pathname}?tab=models&refresh=${Date.now()}`;
            }, 1500);
          } else {
            setError(response.data?.message || 'Failed to upload model');
          }
        } catch (uploadError) {
          console.error('Upload error:', uploadError);
          setError('Error uploading model: ' + (uploadError.response?.data?.message || uploadError.message));
        }
      }
    } catch (err) {
      console.error('Error submitting model:', err);
      setError('Error: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };
  
  const toggleModelStatus = async (modelId) => {
    try {
      console.log('Toggling model status for model ID:', modelId);
      
      // Find the model in the state - check both id and _id properties
      const model = models.find(m => 
        m.id === modelId || 
        (m._id && m._id.toString() === modelId) ||
        (m._id && m._id === modelId)
      );
      
      if (!model) {
        setError('Model not found with ID: ' + modelId);
        return;
      }
      
      const newStatus = !model.active;
      console.log('Changing model status from', model.active, 'to', newStatus);
      
      // Check if we're trying to deactivate the only active model
      if (!newStatus) {
        // Count active models
        const activeModels = models.filter(m => m.active && (m.id !== modelId && m._id?.toString() !== modelId));
        if (activeModels.length === 0) {
          setError('Cannot deactivate the only active model. At least one model must remain active.');
          return;
        }
      }
      
      // If activating this model, we need to deactivate all others (only one active model allowed)
      if (newStatus) {
        // First update the UI to show immediate feedback
        const updatedModels = models.map(m => {
          if (m.id === modelId || (m._id && m._id.toString() === modelId) || (m._id && m._id === modelId)) {
            return {...m, active: true};
          } else {
            return {...m, active: false};
          }
        });
        setModels(updatedModels);
      } else {
        // Just update this model's status
        const updatedModels = models.map(m => {
          if (m.id === modelId || (m._id && m._id.toString() === modelId) || (m._id && m._id === modelId)) {
            return {...m, active: false};
          }
          return m;
        });
        setModels(updatedModels);
      }
      
      // Call the API to update the model status
      try {
        // Use the mlAPI method to update the model status
        // Try to use _id first, then fall back to id
        const actualModelId = model._id?.toString() || model.id;
        console.log('Using model ID for status update API call:', actualModelId);
        await mlAPI.updateModelStatus(actualModelId, newStatus);
        console.log('Model status updated successfully');
        
        // Show success message
        setSuccess(`Model ${newStatus ? 'activated' : 'deactivated'} successfully. Page will refresh automatically...`);
        
        // Add a slight delay before refreshing the page to ensure the backend has fully processed
        setTimeout(() => {
          console.log('Forcing complete page reload after model status update');
          // Navigate back to this page with the models tab active and a timestamp to force reload
          window.location.href = `${window.location.pathname}?tab=models&refresh=${Date.now()}`;
        }, 1000);
      } catch (apiError) {
        console.error('API error when toggling model status:', apiError);
        setError('Failed to update model status: ' + (apiError.response?.data?.message || apiError.message));
        
        // Refresh models to ensure UI is in sync with the server
        await refreshModels();
      }
    } catch (err) {
      console.error('Error toggling model status:', err);
      setError('Failed to update model status: ' + (err.message || 'Unknown error'));
    }
  };
  
  // Function to delete a model
  const deleteModel = async (modelId) => {
    try {
      console.log('Attempting to delete model with ID:', modelId);
      
      // Find the model in the state
      const model = models.find(m => 
        m.id === modelId || 
        (m._id && m._id.toString() === modelId) ||
        (m._id && m._id === modelId)
      );
      
      if (!model) {
        setError('Model not found with ID: ' + modelId);
        return;
      }
      
      // Check if this is an active model
      if (model.active) {
        // Count active models
        const activeModels = models.filter(m => m.active);
        if (activeModels.length === 1) {
          setError('Cannot delete the only active model. Activate another model first.');
          return;
        }
      }
      
      // Confirm deletion
      if (!window.confirm(`Are you sure you want to delete the model "${model.name}"? This action cannot be undone.`)) {
        return;
      }
      
      setLoading(true);
      
      // Call API to delete the model
      const actualModelId = model._id?.toString() || model.id;
      await mlAPI.deleteModel(actualModelId);
      
      // Show success message
      setSuccess('Model deleted successfully. Page will refresh automatically...');
      
      // Add a slight delay before refreshing the page
      setTimeout(() => {
        console.log('Forcing complete page reload after model deletion');
        // Navigate back to this page with the models tab active and a timestamp to force reload
        window.location.href = `${window.location.pathname}?tab=models&refresh=${Date.now()}`;
      }, 1000);
    } catch (err) {
      console.error('Error deleting model:', err);
      setError('Failed to delete model: ' + (err.response?.data?.message || err.message));
      setLoading(false);
    }
  };
  
  // Add this new function for refreshing only the analytics data
  const refreshAnalyticsData = async () => {
    try {
      setAnalyticsLoading(true);
      setError('');
      
      console.log('AdminDashboard: Refreshing analytics data only');
      
      // Fetch both stats and users data to ensure we have complete information
      const [statsResponse, usersResponse] = await Promise.all([
        adminAPI.getStats(),
        adminAPI.getUsers()
      ]);
      
      console.log('AdminDashboard: Stats response:', statsResponse);
      console.log('AdminDashboard: Users response:', usersResponse);
      
      if (statsResponse.data?.data && usersResponse.data?.data) {
        const statsData = statsResponse.data.data;
        const userStats = statsData.users || {};
        const userData = usersResponse.data.data;
        
        // Update site stats
        setSiteStats({
          totalUsers: userStats.totalCount || 0,
          totalAdmins: userStats.adminCount || 0,
          newUsersThisMonth: userStats.recentUsers || 0,
          activeUsersToday: userStats.activeUsers || 0,
          userRegistrations: userData || []
        });
        
        // Update users state as well
        setUsers(userData);
        
        // Generate chart data from the complete user list
        console.log('AdminDashboard: Generating chart with complete user data');
        const chartData = generateUserRegistrationData(userData);
        setVisitData(chartData);
        
        // Show success message
        setSuccess('Analytics data refreshed successfully');
        setTimeout(() => setSuccess(''), 3000); // Auto-clear success message after 3 seconds
      } else {
        console.warn('AdminDashboard: Failed to refresh analytics data - unexpected response format');
        setError('Failed to refresh analytics data. Please try again.');
      }
    } catch (error) {
      console.error('AdminDashboard: Error refreshing analytics:', error);
      setError('Failed to refresh analytics data: ' + (error.message || 'Unknown error'));
    } finally {
      setAnalyticsLoading(false);
    }
  };
  
  // Add a new function to refresh just the models list
  const refreshModels = async () => {
    try {
      console.log('AdminDashboard: Refreshing ML models list');
      setLoading(true);
      
      const modelsResponse = await mlAPI.getModels();
      console.log('AdminDashboard: ML models response:', modelsResponse);
      
      // Handle different response formats
      let modelsList = [];
      
      if (modelsResponse && modelsResponse.data) {
        if (Array.isArray(modelsResponse.data)) {
          // Direct array
          modelsList = modelsResponse.data;
        } else if (modelsResponse.data.data && Array.isArray(modelsResponse.data.data)) {
          // Nested data property with array
          modelsList = modelsResponse.data.data;
        } else if (modelsResponse.data.availableModels) {
          // Format from original ML service
          const activeModelName = modelsResponse.data.activeModel;
          modelsList = [{
            id: 'default-model',
            name: 'Kidney Stone Detection Model',
            version: '1.0',
            accuracy: 0.92,
            createdAt: new Date().toISOString(),
            active: activeModelName === 'joblib'
          }];
        } else if (typeof modelsResponse.data === 'object') {
          // Single model object
          modelsList = [modelsResponse.data];
        } else {
          console.warn('AdminDashboard: Unexpected models response format');
        }
      }
      
      // Format accuracy as decimal if needed
      modelsList = modelsList.map(model => ({
        ...model,
        accuracy: typeof model.accuracy === 'string' ? 
          parseFloat(model.accuracy) : model.accuracy || 0.92
      }));
      
      console.log('AdminDashboard: Refreshed models list:', modelsList);
      setModels(modelsList);
    } catch (error) {
      console.error('AdminDashboard: Error refreshing models:', error);
      setError('Failed to refresh ML models: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return (
      <div className="text-center p-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3">Loading admin dashboard...</p>
      </div>
    );
  }
  
  return (
    <Container className="py-4">
      <Row className="mb-4 align-items-center">
        <Col>
          <h1 style={{ color: 'var(--primary-color)' }}>
            <i className="fas fa-user-shield me-2"></i>
            Admin Dashboard
          </h1>
          <p className="text-muted">Manage users, ML models, and view site analytics</p>
        </Col>
      </Row>
      
      {error && (
        <Alert variant="danger" className="mb-4">
          <Alert.Heading>Error</Alert.Heading>
          <p>{error}</p>
          <div className="d-flex justify-content-end">
            <Button variant="outline-danger" onClick={() => setError('')}>Dismiss</Button>
          </div>
        </Alert>
      )}
      
      {success && (
        <Alert variant="success" className="mb-4" onClose={() => setSuccess('')} dismissible>
          <Alert.Heading>Success</Alert.Heading>
          <p>{success}</p>
        </Alert>
      )}
      
      <Tabs activeKey={activeTab} onSelect={(key) => setActiveTab(key)} className="mb-4">
        <Tab eventKey="users" title={<span><i className="fas fa-users me-2"></i>User Management</span>}>
          <Card className="shadow-sm mb-4">
            <Card.Body>
              <div className="d-flex justify-content-between mb-3">
                <h5 className="card-title">System Users</h5>
                <Button variant="primary" onClick={openCreateUserModal}>
                  <i className="fas fa-user-plus me-2"></i>
                  Add User
                </Button>
              </div>
              
              <div className="table-responsive">
                <Table striped hover>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Created Date</th>
                      <th>Last Login</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length > 0 ? (
                      users.map((user, index) => {
                        // Debug: Log the first user object to see its structure
                        if (index === 0) {
                          console.log('User object structure:', JSON.stringify(user, null, 2));
                        }
                        
                        return (
                          <tr key={user._id || user.id}>
                            <td>{user.name}</td>
                            <td>{user.email}</td>
                            <td>
                              <span className={`badge bg-${user.role === 'admin' ? 'danger' : 'info'}`}>
                                {user.role}
                              </span>
                            </td>
                            <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                            <td>{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}</td>
                            <td>
                              <Button variant="outline-primary" size="sm" className="me-2" onClick={() => openEditUserModal(user)}>
                                <i className="fas fa-edit"></i>
                              </Button>
                              <Button variant="outline-secondary" size="sm" className="me-2" onClick={() => openChangePasswordModal(user)}>
                                <i className="fas fa-key"></i>
                              </Button>
                              <Button 
                                variant="outline-danger" 
                                size="sm" 
                                onClick={() => {
                                  console.log('Delete button clicked for user:', user);
                                  console.log('User ID for deletion:', user._id);
                                  handleDeleteUser(user._id);
                                }}
                              >
                                <i className="fas fa-trash"></i>
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="6" className="text-center py-4">
                          <div className="alert alert-info mb-0">
                            <i className="fas fa-info-circle me-2"></i>
                            No users found. Add a user to get started.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </Tab>
        
        <Tab eventKey="models" title={<span><i className="fas fa-brain me-2"></i>ML Models</span>}>
          <Card className="shadow-sm mb-4">
            <Card.Body>
              <div className="d-flex justify-content-between mb-3">
                <h5 className="card-title">ML Models Management</h5>
                <div>
                  <Button variant="outline-secondary" onClick={refreshModels} className="me-2" disabled={loading}>
                    <i className="fas fa-sync-alt me-2"></i>
                    Refresh
                  </Button>
                  <Button variant="primary" onClick={() => openModelModal()}>
                    <i className="fas fa-upload me-2"></i>
                    Upload New Model
                  </Button>
                </div>
              </div>
              
              <div className="table-responsive">
                <Table striped hover>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Version</th>
                      <th>Accuracy</th>
                      <th>Created Date</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.length > 0 ? (
                      models.map(model => (
                        <tr key={model.id} className={model.active ? 'table-success' : ''}>
                        <td>{model.name}</td>
                          <td>{model.version || '1.0'}</td>
                          <td>{typeof model.accuracy === 'number' ? model.accuracy.toFixed(2) : (parseFloat(model.accuracy) || 0).toFixed(2)}</td>
                        <td>{new Date(model.createdAt).toLocaleDateString()}</td>
                        <td>
                          <span className={`badge bg-${model.active ? 'success' : 'secondary'}`}>
                            {model.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <Button variant="outline-primary" size="sm" className="me-2" onClick={() => openModelModal(model)}>
                            <i className="fas fa-edit"></i>
                          </Button>
                          <Button 
                            variant={model.active ? "outline-secondary" : "outline-success"} 
                            size="sm" 
                            className="me-2"
                            onClick={() => toggleModelStatus(model._id?.toString() || model.id)}
                          >
                            <i className={`fas fa-${model.active ? 'pause' : 'play'}`}></i>
                          </Button>
                          <Button 
                            variant="outline-danger" 
                            size="sm"
                            onClick={() => deleteModel(model._id?.toString() || model.id)}
                          >
                            <i className="fas fa-trash"></i>
                          </Button>
                        </td>
                      </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="text-center py-4">
                          <div className="alert alert-info mb-0">
                            <i className="fas fa-info-circle me-2"></i>
                            No models found. Upload a model to get started.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </Tab>
        
        <Tab eventKey="analytics" title={<span><i className="fas fa-chart-line me-2"></i>Analytics</span>}>
          <Row>
            <Col lg={8}>
              <Card className="shadow-sm mb-4">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-4">
                    <h5 className="card-title mb-0">Monthly User Registrations</h5>
                    <Button 
                      variant="outline-primary" 
                      size="sm" 
                      onClick={refreshAnalyticsData}
                      disabled={analyticsLoading}
                    >
                      {analyticsLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Refreshing...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-sync-alt me-2"></i>
                          Refresh Data
                        </>
                      )}
                    </Button>
                  </div>
                  <div style={{ height: '300px' }}>
                    <Line 
                      data={visitData} 
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                          y: {
                            beginAtZero: true,
                            title: {
                              display: true,
                              text: 'Number of Users'
                            },
                            ticks: {
                              stepSize: 1,
                              precision: 0
                            }
                          },
                          x: {
                            title: {
                              display: true,
                              text: 'Month'
                            }
                          }
                        },
                        plugins: {
                          legend: {
                            position: 'top',
                          },
                          title: {
                            display: false
                          },
                          tooltip: {
                            callbacks: {
                              label: function(context) {
                                return `${context.dataset.label}: ${context.raw} users`;
                              }
                            }
                          }
                        }
                      }}
                    />
                  </div>
                </Card.Body>
              </Card>
            </Col>
            
            <Col lg={4}>
              <Card className="shadow-sm mb-4">
                <Card.Body>
                  <h5 className="card-title mb-3">System Statistics</h5>
                  
                  <div className="mb-3 p-3 border rounded bg-light">
                    <h2 className="text-primary mb-0">{siteStats.totalUsers}</h2>
                    <p className="text-muted mb-0">Total Users</p>
                  </div>
                  
                  <div className="mb-3 p-3 border rounded bg-light">
                    <h2 className="text-primary mb-0">{siteStats.newUsersThisMonth}</h2>
                    <p className="text-muted mb-0">New Users This Month</p>
                  </div>
                  
                  <div className="d-flex gap-2">
                    <div className="p-3 border rounded bg-light flex-grow-1">
                      <h3 className="text-info mb-0">{siteStats.activeUsersToday}</h3>
                      <p className="text-muted mb-0 small">Active Users Today</p>
                    </div>
                    
                    <div className="p-3 border rounded bg-light flex-grow-1">
                      <h3 className="text-warning mb-0">{siteStats.totalAdmins}</h3>
                      <p className="text-muted mb-0 small">Admin Users</p>
                    </div>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Tab>
      </Tabs>
      
      {/* User Modal */}
      <Modal show={showUserModal} onHide={() => setShowUserModal(false)} backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>
            {modalMode === 'create' && 'Add New User'}
            {modalMode === 'edit' && 'Edit User'}
            {modalMode === 'password' && 'Reset User Password'}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSubmitUser}>
          <Modal.Body>
            {modalMode !== 'password' && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Name</Form.Label>
                  <Form.Control
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleUserFormChange}
                    required
                  />
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleUserFormChange}
                    required
                  />
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>Role</Form.Label>
                  <Form.Select
                    name="role"
                    value={formData.role}
                    onChange={handleUserFormChange}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </Form.Select>
                </Form.Group>
              </>
            )}
            
            {modalMode === 'create' && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Temporary Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleUserFormChange}
                    required
                  />
                  <Form.Text className="text-muted">
                    User will be prompted to change this password on first login
                  </Form.Text>
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>Confirm Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleUserFormChange}
                    required
                  />
                </Form.Group>
              </>
            )}
            
            {modalMode === 'password' && (
              <Alert variant="info">
                <i className="fas fa-info-circle me-2"></i>
                <strong>Reset Password for {selectedUser?.name}</strong>
                <p className="mt-2 mb-1">
                  This will:
                </p>
                <ul className="small mb-2">
                  <li>Generate a temporary password for the user</li>
                  <li>Send a password reset email to <strong>{selectedUser?.email}</strong></li>
                  <li>Display the temporary password here for your reference</li>
                </ul>
                <p className="small mb-0">
                  The user will need to change their password upon next login.
                </p>
              </Alert>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowUserModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              {modalMode === 'create' && 'Create User'}
              {modalMode === 'edit' && 'Save Changes'}
              {modalMode === 'password' && 'Send Reset Email'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
      
      {/* Model Modal */}
      <Modal show={showModelModal} onHide={() => setShowModelModal(false)} backdrop="static" size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {selectedModel ? `Edit Model: ${selectedModel.name}` : 'Upload New Model'}
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSubmitModel}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Model Name</Form.Label>
              <Form.Control
                type="text"
                name="name"
                value={modelFormData.name}
                onChange={handleModelFormChange}
                required
                placeholder="Enter model name"
                autoFocus
              />
              <Form.Text className="text-muted">
                {selectedModel ? 'Changes to the model name will be saved immediately.' : 'Choose a descriptive name for your model.'}
              </Form.Text>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                name="description"
                value={modelFormData.description}
                onChange={handleModelFormChange}
                placeholder="Enter model description"
              />
              <Form.Text className="text-muted">
                Describe what this model does, how it was trained, and any other relevant details.
              </Form.Text>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Accuracy</Form.Label>
              <Form.Control
                type="number"
                name="accuracy"
                min="0"
                max="1"
                step="0.01"
                value={modelFormData.accuracy}
                onChange={handleModelFormChange}
                placeholder="0.92"
              />
              <Form.Text className="text-muted">
                Enter the model's accuracy as a decimal between 0 and 1 (e.g., 0.92 for 92%).
              </Form.Text>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Version</Form.Label>
              <Form.Control
                type="text"
                name="version"
                value={modelFormData.version}
                onChange={handleModelFormChange}
                placeholder="1.0"
              />
              <Form.Text className="text-muted">
                Enter the model version (e.g., 1.0, 2.1.3)
              </Form.Text>
            </Form.Group>
            
            {!selectedModel && (
              <>
              <Form.Group className="mb-3">
                <Form.Label>Model File (.joblib)</Form.Label>
                <Form.Control
                  type="file"
                  accept=".joblib"
                  onChange={handleModelFileChange}
                  required
                />
                <Form.Text className="text-muted">
                  Upload kidney_stone_model.joblib file
                </Form.Text>
              </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Check
                    type="checkbox"
                    id="model-active"
                    name="active"
                    label="Set as active model"
                    checked={modelFormData.active}
                    onChange={handleModelFormChange}
                  />
                  <Form.Text className="text-muted">
                    {selectedModel 
                      ? 'Changing this setting will immediately update the model status.' 
                      : 'Activate this model immediately after upload.'}
                  </Form.Text>
                </Form.Group>
              </>
            )}
            
            {selectedModel && (
              <Alert variant="info">
                <i className="fas fa-info-circle me-2"></i>
                Editing an existing model. Changes will be synchronized between the database and model files.
              </Alert>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModelModal(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                  {selectedModel ? 'Saving...' : 'Uploading...'}
                </>
              ) : (
                selectedModel ? 'Save Changes' : 'Upload Model'
              )}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Container>
  );
};

export default AdminDashboard; 