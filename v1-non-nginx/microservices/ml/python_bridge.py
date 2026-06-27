import sys
import json
import joblib
import numpy as np
import argparse
from pathlib import Path

def predict_with_model(model_path, input_data):
    """Make prediction using the specified model"""
    try:
        # Load the model
        print(f"Loading model from {model_path}", file=sys.stderr)
        model = joblib.load(model_path)
        
        # V1 model was trained on 6 OLD parameters in this exact order:
        # ['gravity', 'ph', 'osmo', 'cond', 'urea', 'calc']
        # New system sends 9 parameters; we map them to the old 6 format
        features = ['gravity', 'ph', 'osmo', 'cond', 'urea', 'calc']
        
        # Ensure input_data is a dictionary
        if not isinstance(input_data, dict):
            raise ValueError("Input data must be a dictionary")
        
        # Log ignored categorical parameters
        if 'turbidityLevel' in input_data or 'warnaDasar' in input_data:
            print(f"Ignoring categoricals: turbidityLevel={input_data.get('turbidityLevel')}, warnaDasar={input_data.get('warnaDasar')}", file=sys.stderr)
        
        # Map new 9 parameters to old 6 parameters
        # This allows the V1 model (trained on old params) to work with new data
        mapped_data = {}
        
        # Direct mappings from new params to old params
        if 'specificGravity' in input_data:
            mapped_data['gravity'] = float(input_data['specificGravity'])
        elif 'gravity' in input_data:
            mapped_data['gravity'] = float(input_data['gravity'])
        else:
            raise ValueError("Missing required parameter: specificGravity (maps to gravity)")
        
        if 'ph' in input_data:
            mapped_data['ph'] = float(input_data['ph'])
        else:
            raise ValueError("Missing required parameter: ph")
        
        # TDS (Total Dissolved Solids) approximates osmolality
        if 'tds' in input_data:
            mapped_data['osmo'] = float(input_data['tds'])
        elif 'osmo' in input_data:
            mapped_data['osmo'] = float(input_data['osmo'])
        else:
            mapped_data['osmo'] = 800.0  # Default TDS/osmo value
            print(f"Using default for osmo (tds): 800", file=sys.stderr)
        
        # Turbidity (NTU) can proxy conductivity in urine analysis
        if 'turbidityNTU' in input_data:
            mapped_data['cond'] = float(input_data['turbidityNTU'])
        elif 'cond' in input_data:
            mapped_data['cond'] = float(input_data['cond'])
        else:
            mapped_data['cond'] = 15.0  # Default turbidity/conductivity
            print(f"Using default for cond (turbidityNTU): 15.0", file=sys.stderr)
        
        # Urea and calc not in new params - use realistic defaults
        if 'urea' in input_data:
            mapped_data['urea'] = float(input_data['urea'])
        else:
            mapped_data['urea'] = 300.0  # Default urea concentration (mg/dL)
            print(f"Using default for urea: 300.0", file=sys.stderr)
        
        if 'calc' in input_data:
            mapped_data['calc'] = float(input_data['calc'])
        else:
            mapped_data['calc'] = 5.0  # Default calcium (mmol/L)
            print(f"Using default for calc: 5.0", file=sys.stderr)
        
        # Log the parameter mapping for debugging
        print(f"Mapped new params to V1 model format: specificGravity→gravity, tds→osmo, turbidityNTU→cond, defaults for urea/calc", file=sys.stderr)
        
        # Create feature array in exact order V1 model expects
        feature_values = []
        for feature in features:
            if feature not in mapped_data:
                raise ValueError(f"Missing mapped feature: {feature}")
            feature_values.append(mapped_data[feature])
            
        X = np.array([feature_values])
        
        # Make prediction
        prediction = model.predict(X)
        
        # Map prediction to class name
        predicted_class = "Abnormal" if prediction[0] == 1 else "Normal"
        
        # Return result in the expected format
        # Preserve full parameters (all 9) in response even though only 7 used for prediction
        return {
            "success": True,
            "result": prediction.tolist(),  # Convert numpy array to list
            "predictedClass": predicted_class,
            "parameters": input_data,  # All 9 params including categoricals
            "featuresUsed": features  # Show which 7 numeric features were used
        }
    except Exception as e:
        print(f"Error making prediction: {str(e)}", file=sys.stderr)
        return {
            "success": False,
            "error": str(e)
        }

def main():
    parser = argparse.ArgumentParser(description='Make predictions using a joblib model')
    parser.add_argument('--model', required=True, help='Path to the joblib model file')
    parser.add_argument('--input', required=True, help='Path to input JSON file')
    parser.add_argument('--output', required=True, help='Path to output JSON file')
    args = parser.parse_args()

    try:
        # Read input data
        with open(args.input, 'r') as f:
            input_data = json.load(f)
        
        # Make prediction
        result = predict_with_model(args.model, input_data)
        
        # Write result to stdout
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == '__main__':
    main() 