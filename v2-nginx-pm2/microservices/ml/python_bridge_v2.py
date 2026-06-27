#!/usr/bin/env python3
"""
Python Bridge V2 for Kidney Stone Ensemble Model
Loads .pkl models (RandomForest + XGBoost ensemble) and performs predictions
with preprocessing from 9 backend parameters to 5 model features
"""

import sys
import json
import pickle
import numpy as np
import argparse
from pathlib import Path

def preprocess_input_to_features(input_data):
    """
    Preprocess 9 backend parameters into 5 model features
    
    Input (9 params):
        - ph, tds, specificGravity, turbidityNTU
        - red, green, blue (RGB color values)
        - turbidityLevel, warnaDasar
    
    Output (5 features):
        - Warna (categorical): from warnaDasar or RGB analysis
        - Kejernihan (categorical): from turbidityLevel
        - pH (numeric): direct copy
        - Berat Jenis (numeric): from specificGravity or TDS calculation
        - NTU (numeric): from turbidityNTU
    """
    try:
        # Extract input parameters
        ph = float(input_data.get('ph', 0))
        tds = float(input_data.get('tds', 0))
        specific_gravity = float(input_data.get('specificGravity', 0))
        turbidity_ntu = float(input_data.get('turbidityNTU', 0))
        red = int(input_data.get('red', 0))
        green = int(input_data.get('green', 0))
        blue = int(input_data.get('blue', 0))
        turbidity_level = input_data.get('turbidityLevel', 'Jernih')
        warna_dasar = input_data.get('warnaDasar', 'KUNING')
        
        # Derive Warna from warnaDasar (convert to title case)
        if warna_dasar:
            warna = warna_dasar.title()  # 'KUNING' -> 'Kuning'
        else:
            # Fallback: analyze RGB to determine color
            if red > green + blue:
                warna = 'Merah'
            elif green > red + blue:
                warna = 'Hijau'
            elif blue > red + green:
                warna = 'Biru'
            elif red > 200 and green > 200 and blue < 100:
                warna = 'Kuning'
            elif red > 150 and green > 100 and blue < 50:
                warna = 'Orange'
            elif red > 100 and green > 50 and blue < 30:
                warna = 'Coklat'
            else:
                warna = 'Bening'
        
        # Derive Kejernihan from turbidityLevel
        if 'JERNIH' in turbidity_level.upper():
            kejernihan = 'Jernih'
        elif 'AGAK' in turbidity_level.upper() or 'SEDIKIT' in turbidity_level.upper():
            kejernihan = 'Agak Keruh'
        elif 'KERUH' in turbidity_level.upper():
            kejernihan = 'Keruh'
        else:
            kejernihan = 'Jernih'  # Default
        
        # pH: direct copy
        ph_value = ph
        
        # Berat Jenis: use specificGravity, or calculate from TDS if missing
        if specific_gravity > 0:
            berat_jenis = specific_gravity
        else:
            # Calculate from TDS: SG = 1.0 + (TDS / 1000000)
            berat_jenis = 1.0 + (tds / 1000000.0)
        
        # NTU: direct copy
        ntu_value = turbidity_ntu
        
        features = {
            'Warna': warna,
            'Kejernihan': kejernihan,
            'pH': ph_value,
            'Berat Jenis': berat_jenis,
            'NTU': ntu_value
        }
        
        # Log preprocessing for debugging
        print(f"[PREPROCESS] Input params: pH={ph}, TDS={tds}, SG={specific_gravity}, NTU={turbidity_ntu}, RGB=({red},{green},{blue}), Level={turbidity_level}, Warna={warna_dasar}", file=sys.stderr)
        print(f"[PREPROCESS] Derived features: Warna={warna}, Kejernihan={kejernihan}, pH={ph_value}, SG={berat_jenis}, NTU={ntu_value}", file=sys.stderr)
        
        return features
        
    except Exception as e:
        print(f"[ERROR] Preprocessing failed: {e}", file=sys.stderr)
        raise

def predict_with_v2_model(model_path, input_data):
    """
    Load V2 ensemble model and make prediction
    
    Args:
        model_path: Path to trained_models.pkl
        input_data: Dict with 9 backend parameters
    
    Returns:
        Dict with prediction results
    """
    try:
        # Load trained models and components
        print(f"[INFO] Loading model from: {model_path}", file=sys.stderr)
        with open(model_path, 'rb') as f:
            trained_models = pickle.load(f)
        
        # Extract components
        rf_model = trained_models['rf']
        xgb_model = trained_models['xgb']
        le_warna = trained_models['le_warna']
        le_kejernihan = trained_models['le_kejernihan']
        le_penyakit = trained_models['le_penyakit']
        imputer = trained_models['imputer']
        rf_f1 = trained_models['rf_f1']
        xgb_f1 = trained_models['xgb_f1']
        
        print(f"[INFO] Models loaded: RF (F1={rf_f1:.4f}), XGB (F1={xgb_f1:.4f})", file=sys.stderr)
        
        # Preprocess input to 5 features
        features = preprocess_input_to_features(input_data)
        
        # Encode categorical features
        try:
            warna_encoded = le_warna.transform([features['Warna']])[0]
        except ValueError:
            print(f"[WARN] Unknown Warna value '{features['Warna']}', using default 'Kuning'", file=sys.stderr)
            warna_encoded = le_warna.transform(['Kuning'])[0]
        
        try:
            kejernihan_encoded = le_kejernihan.transform([features['Kejernihan']])[0]
        except ValueError:
            print(f"[WARN] Unknown Kejernihan value '{features['Kejernihan']}', using default 'Jernih'", file=sys.stderr)
            kejernihan_encoded = le_kejernihan.transform(['Jernih'])[0]
        
        # Create feature array [Warna, Kejernihan, pH, Berat Jenis, NTU]
        feature_array = np.array([[
            warna_encoded,
            kejernihan_encoded,
            features['pH'],
            features['Berat Jenis'],
            features['NTU']
        ]])
        
        # Impute missing values (if any)
        feature_array = imputer.transform(feature_array)
        
        print(f"[INFO] Feature array: {feature_array}", file=sys.stderr)
        
        # Predict with RandomForest
        rf_pred = rf_model.predict(feature_array)[0]
        rf_proba = rf_model.predict_proba(feature_array)[0]
        print(f"[INFO] RF prediction: class={rf_pred}, proba={rf_proba}", file=sys.stderr)
        
        # Predict with XGBoost
        xgb_pred = xgb_model.predict(feature_array)[0]
        xgb_proba = xgb_model.predict_proba(feature_array)[0]
        print(f"[INFO] XGB prediction: class={xgb_pred}, proba={xgb_proba}", file=sys.stderr)
        
        # Ensemble: weighted average of probabilities using F1 scores
        ensemble_proba = (rf_f1 * rf_proba + xgb_f1 * xgb_proba) / (rf_f1 + xgb_f1)
        ensemble_pred = np.argmax(ensemble_proba)
        ensemble_confidence = np.max(ensemble_proba)
        
        # Inverse transform to get disease name
        disease_name = le_penyakit.inverse_transform([ensemble_pred])[0]
        rf_disease = le_penyakit.inverse_transform([rf_pred])[0]
        xgb_disease = le_penyakit.inverse_transform([xgb_pred])[0]
        
        print(f"[INFO] Ensemble prediction: class={ensemble_pred} ({disease_name}), confidence={ensemble_confidence:.4f}", file=sys.stderr)
        
        # Return result in expected format
        result = {
            'success': True,
            'result': [int(ensemble_pred)],
            'predictedClass': disease_name,
            'confidence': float(ensemble_confidence),
            'rfPrediction': int(rf_pred),
            'rfClass': rf_disease,
            'xgbPrediction': int(xgb_pred),
            'xgbClass': xgb_disease,
            'parameters': input_data,
            'preprocessedFeatures': {
                'Warna': features['Warna'],
                'Kejernihan': features['Kejernihan'],
                'pH': features['pH'],
                'Berat_Jenis': features['Berat Jenis'],
                'NTU': features['NTU']
            }
        }
        
        return result
        
    except Exception as e:
        print(f"[ERROR] Prediction failed: {e}", file=sys.stderr)
        return {
            'success': False,
            'error': str(e),
            'parameters': input_data
        }

def main():
    """
    Main function: parse arguments, load input, run prediction, output JSON
    """
    parser = argparse.ArgumentParser(description='V2 Ensemble Model Prediction Bridge')
    parser.add_argument('--model', required=True, help='Path to trained_models.pkl')
    parser.add_argument('--input', required=True, help='Path to input JSON file')
    parser.add_argument('--output', help='Path to output JSON file (unused, kept for compatibility)')
    
    args = parser.parse_args()
    
    try:
        # Read input JSON
        with open(args.input, 'r') as f:
            input_data = json.load(f)
        
        print(f"[INFO] Input file: {args.input}", file=sys.stderr)
        print(f"[INFO] Model file: {args.model}", file=sys.stderr)
        
        # Run prediction
        result = predict_with_v2_model(args.model, input_data)
        
        # Output result as JSON to stdout
        print(json.dumps(result))
        
        # Exit with appropriate code
        sys.exit(0 if result['success'] else 1)
        
    except FileNotFoundError as e:
        error_result = {
            'success': False,
            'error': f'File not found: {e}'
        }
        print(json.dumps(error_result))
        sys.exit(1)
        
    except json.JSONDecodeError as e:
        error_result = {
            'success': False,
            'error': f'Invalid JSON: {e}'
        }
        print(json.dumps(error_result))
        sys.exit(1)
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == '__main__':
    main()
