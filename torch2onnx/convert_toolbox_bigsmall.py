# torch2onnx/convert_toolbox_bigsmall.py
import torch
import torch.nn as nn
import onnx
import json
import sys
import os
from pathlib import Path

# Add rPPG-Toolbox to path to import models
sys.path.append(str(Path(__file__).parent.parent / "rPPG-Toolbox"))
from neural_methods.model.BigSmall import BigSmall

def convert_bigsmall_to_onnx(weights_path, onnx_output_path, config_output_path):
    device = torch.device("cpu")
    
    # BigSmall Config
    n_segment = 3
    # Based on size mismatch analysis:
    # big_input: 144x144 -> pool2 -> 72 -> pool2 -> 36 -> pool4 -> 9x9
    # small_input: 9x9 (matches the concat size)
    big_h, big_w = 144, 144
    small_h, small_w = 9, 9
    
    # Initialize Model
    model = BigSmall(
        in_channels=3,
        nb_filters1=32,
        nb_filters2=64,
        kernel_size=3,
        dropout_rate1=0.25,
        dropout_rate2=0.5,
        dropout_rate3=0.5,
        nb_dense=128,
        out_size_bvp=1,
        out_size_resp=1,
        out_size_au=12,
        n_segment=n_segment
    ).to(device)
    
    # Load Weights
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
    
    # Dummy Inputs: a list of [big_input, small_input]
    batch_size = 1
    nt = batch_size * n_segment
    
    dummy_big = torch.randn(nt, 3, big_h, big_w)
    dummy_small = torch.randn(nt, 3, small_h, small_w)
    
    # Export
    print(f"Exporting BigSmall (144x144, 9x9) to {onnx_output_path}...")
    torch.onnx.export(
        model,
        ([dummy_big, dummy_small],),
        onnx_output_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['big_input', 'small_input'],
        output_names=['au_out', 'bvp_out', 'resp_out'],
        dynamic_axes={
            'big_input': {0: 'total_frames'},
            'small_input': {0: 'total_frames'}
        }
    )
    
    # Create Web Config
    config = {
        "FRAME_NUM": n_segment,
        "TASKS": ["AU", "BVP", "RESP"],
        "FS": 30,
        "sampling_rate": 30,
        "input_size": {
            "big": [nt, 3, big_h, big_w],
            "small": [nt, 3, small_h, small_w]
        },
        "output_names": ["au_out", "bvp_out", "resp_out"],
        "model_path": f"/models/bigsmall/{Path(onnx_output_path).name}",
        "model_info": {
            "name": "BigSmall_Multitask_BP4D",
            "version": "1.0",
            "description": "Multitask model for AUs (12), BVP and Respiration"
        }
    }
    
    with open(config_output_path, 'w') as f:
        json.dump(config, f, indent=4)
        
    print(f"BigSmall Config generated at {config_output_path}")

if __name__ == "__main__":
    weights = "rPPG-Toolbox/final_model_release/BP4D_BigSmall_Multitask_Fold1.pth"
    onnx_out = "public/models/bigsmall/model.onnx"
    config_out = "public/models/bigsmall/config.json"
    
    os.makedirs(os.path.dirname(onnx_out), exist_ok=True)
    convert_bigsmall_to_onnx(weights, onnx_out, config_out)
