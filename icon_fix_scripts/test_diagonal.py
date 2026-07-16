import sys
from PIL import Image

img = Image.open("docs/logo.png").convert("RGBA")
w, h = img.size

# Let's print the colors of the diagonal
for x in range(30):
    print(f"Diagonal {x},{x}: {img.getpixel((x, x))}")
