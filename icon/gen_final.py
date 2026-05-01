import cairosvg
import os

desktop = "/mnt/c/Users/markm/Desktop/shelfdeck_logo/final"
svg_path = os.path.join(desktop, "shelfdeck_icon_B_tri1.svg")

cairosvg.svg2png(url=svg_path, write_to=os.path.join(desktop, "shelfdeck_logo_dark.png"),
                 output_width=1024, output_height=1024, background_color="#1E1E24")
cairosvg.svg2png(url=svg_path, write_to=os.path.join(desktop, "shelfdeck_logo_transparent.png"),
                 output_width=1024, output_height=1024)
print("Done")
