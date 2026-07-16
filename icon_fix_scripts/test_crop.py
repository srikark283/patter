import sys
from PIL import Image

img = Image.open("docs/logo.png").convert("RGBA")
# print out colors of top-left corner, center, top-middle, left-middle
print(f"Size: {img.size}")
print(f"Top-Left (0,0): {img.getpixel((0,0))}")
print(f"Top-Left (10,10): {img.getpixel((10,10))}")
print(f"Center: {img.getpixel((img.size[0]//2, img.size[1]//2))}")
print(f"Top-Middle: {img.getpixel((img.size[0]//2, 0))}")
print(f"Left-Middle: {img.getpixel((0, img.size[1]//2))}")
