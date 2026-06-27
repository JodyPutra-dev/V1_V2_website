#!/usr/bin/env python3
"""
Python Bridge V2 for Kidney Stone Ensemble Model - V1 Deployment Copy
Identical to main microservices/ml/python_bridge_v2.py
"""

import sys
import json
import pickle
import numpy as np
import argparse
from pathlib import Path

def preprocess_input_to_features(input_data):
    """Preprocess 9 backend parameters into 5 model features"""
    try:
        ph = float(input_data.get('ph', 0))
        tds = float(input_data.get('tds', 0))
        specific_gravity = float(input_data.get('specificGravity', 0))
        turbidity_ntu = float(input_data.get('turbidityNTU', 0))
        red = int(input_data.get('red', 0))
        green = int(input_data.get('green', 0))
        blue = int(input_data.get('blue', 0))
        turbidity_level = input_data.get('turbidityLevel', 'Jernih')
        warna_dasar = input_data.get('warnaDasar', 'KUNING')
        
        # Derive Warna
        if warna_dasar:
            warna = warna_dasar.title()
        else:
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
        
        # Derive Kejernihan
        if 'JERNIH' in turbidity_level.upper():
            kejernihan = 'Jernih'
        elif 'AGAK' in turbidity_level.upper() or 'SEDIKIT' in turbidity_level.upper():
            kejernihan = 'Agak Keruh'
        elif 'KERUH' in turbidity_level.upper():
            kejernihan = 'Keruh'
        else:
            kejernihan = 'Jernih'
        
        ph_value = ph
        berat_jenis = specific_gravity if specific_gravity > 0 else 1.0 + (tds / 1000000.0)
        ntu_value = turbidity_ntu
        
        features = {
            'Warna': warna,
            'Kejernihan': kejernihan,
            'pH': ph_value,
            'Berat Jenis': berat_jenis,
            'NTU': ntu_value
        }
        
        print(f"[PREPROCESS] Input params: pH={ph}, TDS={tds}, SG={specific_gravity}, NTU={turbidity_ntu}, RGB=({red},{green},{blue}), Level={turbidity_level}, Warna={warna_dasar}", file=sys.stderr)
        print(f"[PREPROCESS] Derived features: Warna={warna}, Kejernihan={kejernihan}, pH={ph_value}, SG={berat_jenis}, NTU={ntu_value}", file=sys.stderr)
        
        return features
    except Exception as e:
        print(f"[ERROR] Preprocessing failed: {e}", file=sys.stderr)
        raise

def predict_with_v2_model(model_path, input_data):
    """Load V2 ensemble model and make prediction"""
    try:
        print(f"[INFO] Loading model from: {model_path}", file=sys.stderr)
        with open(model_path, 'rb') as f:
            trained_models = pickle.load(f)
        
        rf_model = trained_models['rf']
        xgb_model = trained_models['xgb']
        le_warna = trained_models['le_warna']
        le_kejernihan = trained_models['le_kejernihan']
        le_penyakit = trained_models['le_penyakit']
        imputer = trained_models['imputer']
        rf_f1 = trained_models['rf_f1']
        xgb_f1 = trained_models['xgb_f1']
        
        print(f"[INFO] Models loaded: RF (F1={rf_f1:.4f}), XGB (F1={xgb_f1:.4f})", file=sys.stderr)
        
        features = preprocess_input_to_features(input_data)
        
        try:
            warna_encoded = le_warna.transform([features['Warna']])[0]
        except ValueError:
            print(f"[WARN] Unknown Warna '{features['Warna']}', using 'Kuning'", file=sys.stderr)
            warna_encoded = le_warna.transform(['Kuning'])[0]
        
        try:
            kejernihan_encoded = le_kejernihan.transform([features['Kejernihan']])[0]
        except ValueError:
            print(f"[WARN] Unknown Kejernihan '{features['Kejernihan']}', using 'Jernih'", file=sys.stderr)
            kejernihan_encoded = le_kejernihan.transform(['Jernih'])[0]
        
        feature_array = np.array([[
            warna_encoded,
            kejernihan_encoded,
            features['pH'],
            features['Berat Jenis'],
            features['NTU']
        ]])
        
        feature_array = imputer.transform(feature_array)
        
        print(f"[INFO] Feature array: {feature_array}", file=sys.stderr)
        
        rf_pred = rf_model.predict(feature_array)[0]
        rf_proba = rf_model.predict_proba(feature_array)[0]
        print(f"[INFO] RF prediction: class={rf_pred}, proba={rf_proba}", file=sys.stderr)
        
        xgb_pred = xgb_model.predict(feature_array)[0]
        xgb_proba = xgb_model.predict_proba(feature_array)[0]
        print(f"[INFO] XGB prediction: class={xgb_pred}, proba={xgb_proba}", file=sys.stderr)
        
        ensemble_proba = (rf_f1 * rf_proba + xgb_f1 * xgb_proba) / (rf_f1 + xgb_f1)
        ensemble_pred = np.argmax(ensemble_proba)
        ensemble_confidence = np.max(ensemble_proba)
        
        disease_name = le_penyakit.inverse_transform([ensemble_pred])[0]
        rf_disease = le_penyakit.inverse_transform([rf_pred])[0]
        xgb_disease = le_penyakit.inverse_transform([xgb_pred])[0]
        
        print(f"[INFO] Ensemble prediction: class={ensemble_pred} ({disease_name}), confidence={ensemble_confidence:.4f}", file=sys.stderr)
        
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
    parser = argparse.ArgumentParser(description='V2 Ensemble Model Prediction Bridge')
    parser.add_argument('--model', required=True, help='Path to trained_models.pkl')
    parser.add_argument('--input', required=True, help='Path to input JSON file')
    parser.add_argument('--output', help='Path to output JSON file')
    
    args = parser.parse_args()
    
    try:
        with open(args.input, 'r') as f:
            input_data = json.load(f)
        
        print(f"[INFO] Input file: {args.input}", file=sys.stderr)
        print(f"[INFO] Model file: {args.model}", file=sys.stderr)
        
        result = predict_with_v2_model(args.model, input_data)
        print(json.dumps(result))
        sys.exit(0 if result['success'] else 1)
    except FileNotFoundError as e:
        print(json.dumps({'success': False, 'error': f'File not found: {e}'}))
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(json.dumps({'success': False, 'error': f'Invalid JSON: {e}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
