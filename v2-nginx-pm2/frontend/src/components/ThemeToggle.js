import React, { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';

const ThemeToggle = () => {
  // Initialize theme from localStorage or default to 'orange'
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('colorTheme') || 'orange';
  });

  // Apply theme on component mount and theme change
  useEffect(() => {
    // Update body class for theming
    document.body.classList.remove('theme-orange', 'theme-blue');
    document.body.classList.add(`theme-${theme}`);
    
    // Save theme preference to localStorage
    localStorage.setItem('colorTheme', theme);
  }, [theme]);

  // Toggle between orange and blue themes
  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'orange' ? 'blue' : 'orange');
  };

  return (
    <Button 
      variant="link" 
      className="theme-toggle p-0" 
      onClick={toggleTheme} 
      aria-label="Toggle theme"
    >
      {theme === 'orange' ? (
        <i className="fas fa-moon" style={{ color: 'white' }}></i>
      ) : (
        <i className="fas fa-sun" style={{ color: 'white' }}></i>
      )}
    </Button>
  );
};

export default ThemeToggle; 