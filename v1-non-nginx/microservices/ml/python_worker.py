#!/usr/bin/env python3
"""
Persistent Python inference worker.

Replaces the per-request spawn model used in python_bridge.py / python_bridge_v2.py.
Loads the ML model ONCE at startup, then serves prediction requests indefinitely
from stdin (one JSON line per request) and writes results to stdout (one JSON line
per response).

This eliminates ~400-500ms of cold-start overhead (interpreter + import + model load)
from every single request, reducing per-prediction latency to pure inference time
(~10-50ms).

Node.js communicates with this process via stdin/stdout IPC.
Protocol:
  startup:  Node.js spawns this script with --model and --model-type args.
  ready:    Worker writes {"ready": true} to stdout when model is loaded.
  request:  Node.js writes a single-line JSON object to stdin.
  response: Worker writes a single-line JSON result to stdout.
  shutdown: Worker exits cleanly when stdin is closed.
"""

import sys
import json
import argparse
import traceback


# ─────────────────────────────────────────────────────────────────────────────
# JOBLIB MODEL PREDICTION (matches python_bridge.py logic)
# ─────────────────────────────────────────────────────────────────────────────

def predict_joblib(model, input_data):
    import numpy as np

    features = ['gravity', 'ph', 'osmo', 'cond', 'urea', 'calc']
    mapped = {}

    if 'specificGravity' in input_data:
        mapped['gravity'] = float(input_data['specificGravity'])
    elif 'gravity' in input_data:
        mapped['gravity'] = float(input_data['gravity'])
    else:
        raise ValueError("Missing: specificGravity")

    mapped['ph'] = float(input_data.get('ph', 0))

    if 'tds' in input_data:
        mapped['osmo'] = float(input_data['tds'])
    elif 'osmo' in input_data:
        mapped['osmo'] = float(input_data['osmo'])
    else:
        mapped['osmo'] = 800.0

    if 'turbidityNTU' in input_data:
        mapped['cond'] = float(input_data['turbidityNTU'])
    elif 'cond' in input_data:
        mapped['cond'] = float(input_data['cond'])
    else:
        mapped['cond'] = 15.0

    mapped['urea'] = float(input_data['urea']) if 'urea' in input_data else 300.0
    mapped['calc'] = float(input_data['calc']) if 'calc' in input_data else 5.0

    X = np.array([[mapped[f] for f in features]])
    prediction = model.predict(X)
    predicted_class = 'Abnormal' if prediction[0] == 1 else 'Normal'

    return {
        'success': True,
        'result': prediction.tolist(),
        'predictedClass': predicted_class,
        'parameters': input_data,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PKL ENSEMBLE MODEL PREDICTION (matches python_bridge_v2.py logic)
# ─────────────────────────────────────────────────────────────────────────────

def _derive_features(input_data):
    ph              = float(input_data.get('ph', 0))
    tds             = float(input_data.get('tds', 0))
    specific_gravity= float(input_data.get('specificGravity', 0))
    turbidity_ntu   = float(input_data.get('turbidityNTU', 0))
    red             = int(input_data.get('red', 0))
    green           = int(input_data.get('green', 0))
    blue            = int(input_data.get('blue', 0))
    turbidity_level = input_data.get('turbidityLevel', 'Jernih')
    warna_dasar     = input_data.get('warnaDasar', 'KUNING')

    warna = warna_dasar.title() if warna_dasar else 'Kuning'

    tl = turbidity_level.upper()
    if 'JERNIH' in tl:
        kejernihan = 'Jernih'
    elif 'AGAK' in tl or 'SEDIKIT' in tl:
        kejernihan = 'Agak Keruh'
    else:
        kejernihan = 'Keruh'

    berat_jenis = specific_gravity if specific_gravity > 0 else 1.0 + (tds / 1_000_000.0)

    return {
        'Warna':       warna,
        'Kejernihan':  kejernihan,
        'pH':          ph,
        'Berat Jenis': berat_jenis,
        'NTU':         turbidity_ntu,
    }


def predict_pkl(trained_models, input_data):
    import numpy as np

    rf_model        = trained_models['rf']
    xgb_model       = trained_models['xgb']
    le_warna        = trained_models['le_warna']
    le_kejernihan   = trained_models['le_kejernihan']
    le_penyakit     = trained_models['le_penyakit']
    imputer         = trained_models['imputer']
    rf_f1           = trained_models['rf_f1']
    xgb_f1          = trained_models['xgb_f1']

    features = _derive_features(input_data)

    try:
        warna_enc = le_warna.transform([features['Warna']])[0]
    except ValueError:
        warna_enc = le_warna.transform(['Kuning'])[0]

    try:
        keruh_enc = le_kejernihan.transform([features['Kejernihan']])[0]
    except ValueError:
        keruh_enc = le_kejernihan.transform(['Jernih'])[0]

    X = np.array([[warna_enc, keruh_enc, features['pH'],
                   features['Berat Jenis'], features['NTU']]])
    X = imputer.transform(X)

    rf_pred  = rf_model.predict(X)[0]
    rf_proba = rf_model.predict_proba(X)[0]

    xgb_pred  = xgb_model.predict(X)[0]
    xgb_proba = xgb_model.predict_proba(X)[0]

    ensemble_proba      = (rf_f1 * rf_proba + xgb_f1 * xgb_proba) / (rf_f1 + xgb_f1)
    ensemble_pred       = int(np.argmax(ensemble_proba))
    ensemble_confidence = float(np.max(ensemble_proba))

    disease_name = le_penyakit.inverse_transform([ensemble_pred])[0]

    return {
        'success':      True,
        'result':       [ensemble_pred],
        'predictedClass': disease_name,
        'confidence':   ensemble_confidence,
        'parameters':   input_data,
    }


# ─────────────────────────────────────────────────────────────────────────────
# WORKER MAIN LOOP
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Persistent ML inference worker')
    parser.add_argument('--model',       required=True,
                        help='Path to the model file (.joblib or .pkl)')
    parser.add_argument('--model-type',  choices=['joblib', 'pkl'], default='joblib',
                        help='Model format')
    args = parser.parse_args()

    sys.stderr.write(f'[WORKER] Starting — model={args.model} type={args.model_type}\n')
    sys.stderr.flush()

    # Load model once
    try:
        if args.model_type == 'pkl':
            import pickle
            with open(args.model, 'rb') as f:
                model = pickle.load(f)
        else:
            import joblib
            model = joblib.load(args.model)
    except Exception as exc:
        sys.stderr.write(f'[WORKER] FATAL — could not load model: {exc}\n')
        sys.stderr.flush()
        sys.exit(1)

    sys.stderr.write('[WORKER] Model loaded. Ready.\n')
    sys.stderr.flush()

    # Signal readiness to Node.js
    sys.stdout.write(json.dumps({'ready': True}) + '\n')
    sys.stdout.flush()

    # Request / response loop
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            request_data = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({'success': False, 'error': f'Invalid JSON: {exc}'}) + '\n')
            sys.stdout.flush()
            continue

        try:
            if args.model_type == 'pkl':
                result = predict_pkl(model, request_data)
            else:
                result = predict_joblib(model, request_data)
        except Exception as exc:
            sys.stderr.write(f'[WORKER] Prediction error: {traceback.format_exc()}\n')
            sys.stderr.flush()
            result = {'success': False, 'error': str(exc)}

        sys.stdout.write(json.dumps(result) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
