from PIL import Image

def make_corners_transparent(filepath):
    img = Image.open(filepath).convert("RGBA")
    pixels = img.load()
    width, height = img.size
    
    def flood_fill(start_x, start_y):
        stack = [(start_x, start_y)]
        visited = set()
        
        while stack:
            x, y = stack.pop()
            if (x, y) in visited:
                continue
            visited.add((x, y))
            
            if x < 0 or x >= width or y < 0 or y >= height:
                continue
                
            r, g, b, a = pixels[x, y]
            if r > 240 and g > 240 and b > 240 and a > 0:
                pixels[x, y] = (255, 255, 255, 0)
                stack.extend([(x+1, y), (x-1, y), (x, y+1), (x, y-1)])

    flood_fill(0, 0)
    flood_fill(width-1, 0)
    flood_fill(0, height-1)
    flood_fill(width-1, height-1)
    
    img.save(filepath)

make_corners_transparent("src-tauri/icons/source-icon.png")
