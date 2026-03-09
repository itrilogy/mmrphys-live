# torch2onnx/convert_toolbox_tscan.py
import torch
import torch.nn as nn
import onnx
import json
import sys
import os
from pathlib import Path

# Add rPPG-Toolbox to path to import models
sys.path.append(str(Path(__file__).parent.parent / "rPPG-Toolbox"))
from neural_methods.model.TS_CAN import TSCAN

def convert_tscan_to_onnx(weights_path, onnx_output_path, config_output_path):
    device = torch.device("cpu")
    
    # 1. Initialize Model
    # TS-CAN in rPPG-Toolbox expects (Batch * Time, 6, H, W)
    # The '6' channels are [Diff_RGB, Raw_RGB]
    frames = 20 # frame_depth/n_segment
    height = 72
    width = 72
    
    # We'll export for a single window of 20 frames
    # Input shape: (20, 6, 72, 72)
    model = TSCAN(frame_depth=frames, img_size=72).to(device)
    
    # 2. Load Weights
    print(f"Loading weights from {weights_path}...")
    checkpoint = torch.load(weights_path, map_location=device)
    
    if isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
        state_dict = checkpoint['state_dict']
    else:
        state_dict = checkpoint
        
    new_state_dict = {}
    for k, v in state_dict.items():
        name = k[7:] if k.startswith('module.') else k
        new_state_dict[name] = v
        
    model.load_state_dict(new_state_dict)
    model.eval()
    
    # 3. Create Dummy Input
    # [Batch * Time, Channels, Height, Width]
    # Here Batch=1, Time=20 -> 20 frames total
    dummy_input = torch.randn(frames, 6, height, width)
    
    # 4. Export to ONNX
    print(f"Exporting to ONNX: {onnx_output_path}...")
    torch.onnx.export(
        model,
        dummy_input,
        onnx_output_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={
            'input': {0: 'total_frames'}, # Allow different window sizes? 
                                          # Note: TSM layer depends on n_segment=20
            'output': {0: 'total_frames'}
        }
    )
    
    # 5. Create Config JSON
    config = {
        "FRAME_NUM": frames,
        "TASKS": ["BVP"],
        "FS": 30,
        "sampling_rate": 30,
        "input_size": [1, 6, frames, height, width], # Logic in JS will handle the tiling
        "output_names": ["output"],
        "model_path": f"/models/rphys/{Path(onnx_output_path).name}", # We replace the lite model
        "model_info": {
            "name": "TS-CAN_PURE",
            "version": "1.0",
            "description": "TS-CAN model trained on PURE dataset"
        },
        "signal_parameters": {
            "bvp": {
                "min_rate": 40,
                "max_rate": 180,
                "buffer_size": frames
            }
        }
    }
    
    with open(config_output_path, 'w') as f:
        json.dump(config, f, indent=4)
    print(f"Config created at {config_output_path}")

if __name__ == "__main__":
    weights = "rPPG-Toolbox/final_model_release/PURE_TSCAN.pth"
    # We put this in the default 'rphys' directory for the 'Lite' scene
    onnx_out = "public/models/rphys/model_tscan.onnx"
    config_out = "public/models/rphys/config_tscan.json"
    
    os.makedirs(os.path.dirname(onnx_out), exist_ok=True)
    convert_tscan_to_onnx(weights, onnx_out, config_out)
