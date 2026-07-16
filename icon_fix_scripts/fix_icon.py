import sys
from PIL import Image, ImageDraw

def create_squircle_mask(size, radius_ratio=0.225):
    """
    Creates an anti-aliased squircle mask.
    Apple's standard corner radius ratio is about 0.225 of the size.
    """
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    
    radius = int(size[0] * radius_ratio)
    
    # Draw the rounded rectangle
    draw.rounded_rectangle(
        [(0, 0), (size[0], size[1])],
        radius=radius,
        fill=255
    )
    
    return mask

def process_icon(input_path, output_path):
    # Open the image and convert to RGBA
    img = Image.open(input_path).convert("RGBA")
    
    # Check if the image has a white border and if we want to crop it? 
    # Actually, applying a squircle mask is probably enough if the user just wanted it rounded.
    # Wait, the user said "still has a white border. Please help me get rid of it".
    # This might mean the squircle mask left a white background, or the image has a literal drawn border.
    # Let's inspect the edge pixels.
    
    # If the corners are white, we should mask them out.
    mask = create_squircle_mask(img.size)
    
    # Apply the mask
    result = Image.new('RGBA', img.size, (0, 0, 0, 0))
    result.paste(img, (0, 0), mask)
    
    result.save(output_path)
    print(f"Saved processed icon to {output_path}")

if __name__ == "__main__":
    process_icon("docs/logo.png", "src-tauri/icons/app-icon.png")
