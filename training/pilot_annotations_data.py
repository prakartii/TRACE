"""Manual BOX/PALLET annotations for the pilot dataset — pixel coordinates
(x1, y1, x2, y2) in the source frame's native 1280x720 resolution.

These were drawn by a human reviewer (this session) visually inspecting
each frame with a coordinate-grid overlay, NOT computed, NOT copied from
a model, and NOT derived from filenames. They are approximate (grid
resolution ~80px) — this is explicitly a pilot-quality annotation set,
not survey-grade ground truth. See training/README.md.

Format: {frame_id: {"box": [(x1,y1,x2,y2), ...], "pallet": [(x1,y1,x2,y2), ...]}}
Frames with no entry, or an empty list for a class, are honest negatives
for that class — not an omission.
"""

ANNOTATIONS = {
    # --- Dock level, dragging cupboard.mp4 (train) ---
    "Dock_level__dragging_cup_t00": {
        "pallet": [(85, 255, 615, 310)],
        "box": [(155, 145, 465, 245), (478, 88, 618, 175)],
    },
    "Dock_level__dragging_cup_t01": {
        "pallet": [(150, 155, 630, 250)],
        "box": [(490, 85, 650, 185)],
    },
    "Dock_level__dragging_cup_t02": {
        "pallet": [(140, 155, 630, 260)],
        "box": [(800, 110, 940, 225)],
    },
    "Dock_level__dragging_cup_t03": {
        "pallet": [(95, 110, 340, 225)],
        "box": [(555, 60, 875, 490)],
    },
    "Dock_level__dragging_cup_t04": {
        "box": [(170, 95, 615, 580), (550, 90, 700, 180)],
    },
    "Dock_level__dragging_cup_t05": {
        "box": [(150, 95, 605, 580)],
    },
    "Dock_level__dragging_cup_t06": {
        "box": [(235, 190, 715, 650), (650, 200, 750, 250)],
    },
    "Dock_level__dragging_cup_t07": {
        "box": [(0, 250, 440, 605), (500, 230, 645, 350)],
    },
    "Dock_level__dragging_cup_t08": {
        "pallet": [(475, 145, 790, 280)],
        "box": [(145, 280, 400, 610)],
    },
    "Dock_level__dragging_cup_t09": {
        "pallet": [(400, 245, 800, 350)],
        "box": [(680, 170, 790, 230)],
    },
    # --- Rolling and dragging on wet floor.mp4 (train) ---
    "Rolling_and_dragging_on_t00": {
        "box": [(555, 270, 650, 430), (530, 580, 650, 710)],
    },
    "Rolling_and_dragging_on_t01": {
        "box": [(580, 175, 650, 330), (530, 610, 650, 715), (430, 630, 530, 715)],
    },
    "Rolling_and_dragging_on_t02": {
        "box": [(580, 390, 650, 475), (880, 245, 1015, 445), (760, 630, 880, 715)],
    },
    "Rolling_and_dragging_on_t03": {
        "box": [(650, 310, 735, 410), (880, 250, 1015, 440)],
    },
    # --- Rolling and dropping carton.mp4 (train) ---
    "Rolling_and_dropping_car_t00": {
        "pallet": [(395, 390, 560, 545)],
        "box": [(560, 85, 800, 280), (555, 290, 725, 520), (705, 395, 865, 545)],
    },
    "Rolling_and_dropping_car_t01": {
        "pallet": [(130, 430, 400, 530)],
        "box": [(555, 0, 900, 250), (490, 225, 670, 605), (730, 430, 970, 635)],
    },
    "Rolling_and_dropping_car_t02": {
        "pallet": [(460, 390, 800, 550)],
        "box": [(540, 225, 770, 430), (650, 0, 1010, 225), (860, 380, 1055, 550)],
    },
    "Rolling_and_dropping_car_t03": {
        "pallet": [(490, 330, 800, 560)],
        "box": [(440, 345, 650, 545), (630, 20, 1010, 310), (895, 555, 1140, 715)],
    },
    "Rolling_and_dropping_car_t04": {
        "pallet": [(460, 340, 810, 570)],
        "box": [
            (395, 340, 560, 530),
            (650, 310, 800, 520),
            (700, 20, 1050, 310),
            (900, 520, 1145, 715),
        ],
    },
    "Rolling_and_dropping_car_t05": {
        "pallet": [(530, 395, 790, 610)],
        "box": [(395, 330, 520, 490), (730, 0, 1140, 250), (960, 420, 1210, 630)],
    },
    # --- Stepping on cartons...mp4 (train) ---
    "Stepping_on_cartons__ver_t00": {"box": [(760, 245, 880, 390)]},
    "Stepping_on_cartons__ver_t01": {
        "box": [(630, 245, 875, 430), (1075, 95, 1180, 175)]
    },
    "Stepping_on_cartons__ver_t02": {
        "box": [(650, 245, 850, 430), (1090, 95, 1200, 185)]
    },
    "Stepping_on_cartons__ver_t03": {"box": [(650, 245, 850, 395)]},
    "Stepping_on_cartons__ver_t04": {
        "box": [(790, 400, 890, 460), (650, 250, 850, 390)]
    },
    "Stepping_on_cartons__ver_t05": {
        "box": [(940, 345, 1060, 465), (800, 310, 870, 420)]
    },
    "Stepping_on_cartons__ver_t06": {},  # honest negative: no defensible box visible
    "Stepping_on_cartons__ver_t07": {"box": [(1030, 280, 1145, 395)]},
    "Stepping_on_cartons__ver_t08": {"box": [(915, 380, 1015, 465)]},
    "Stepping_on_cartons__ver_t09": {"box": [(890, 380, 1030, 500)]},
    "Stepping_on_cartons__ver_t10": {"box": [(890, 380, 1000, 430)]},
    "Stepping_on_cartons__ver_t11": {},  # honest negative
    "Stepping_on_cartons__ver_t12": {"box": [(990, 330, 1080, 410)]},
    "Stepping_on_cartons__ver_t13": {"box": [(980, 330, 1080, 410)]},
    # --- KD packets dragged, heavy box kept on other packets.mp4 (val) ---
    "KD_packets_dragged__heav_t00": {
        "pallet": [(310, 340, 990, 490)],
        "box": [(565, 165, 880, 345), (305, 250, 570, 350), (730, 55, 1000, 205)],
    },
    "KD_packets_dragged__heav_t01": {
        "pallet": [(310, 335, 990, 440)],
        "box": [(555, 110, 880, 340), (305, 225, 560, 340)],
    },
    "KD_packets_dragged__heav_t02": {
        "pallet": [(340, 310, 970, 430)],
        "box": [(560, 90, 880, 320), (340, 195, 560, 320), (860, 15, 1000, 140)],
    },
    "KD_packets_dragged__heav_t03": {
        "pallet": [(440, 395, 1000, 490)],
        "box": [(630, 250, 1010, 420), (440, 280, 650, 400), (440, 160, 630, 250)],
    },
    "KD_packets_dragged__heav_t04": {
        "pallet": [(430, 270, 985, 320)],
        "box": [(635, 95, 915, 280), (430, 195, 650, 290), (875, 30, 1000, 155)],
    },
    "KD_packets_dragged__heav_t05": {
        "pallet": [(440, 345, 1090, 400)],
        "box": [(755, 145, 1090, 350), (440, 245, 760, 350), (595, 30, 850, 170)],
    },
    "KD_packets_dragged__heav_t06": {
        "box": [(400, 45, 790, 290), (810, 150, 1170, 415)]
    },
    "KD_packets_dragged__heav_t07": {
        "box": [(395, 25, 790, 245), (800, 110, 1140, 390)]
    },
    "KD_packets_dragged__heav_t08": {
        "box": [(490, 45, 850, 195), (765, 155, 1045, 375)]
    },
    "KD_packets_dragged__heav_t09": {
        "box": [(490, 170, 840, 280), (770, 175, 1055, 400), (880, 0, 1000, 110)]
    },
    # --- Throwing seating cartons, using strap to hold.mp4 (val) ---
    "Throwing_seating_cartons_t00": {
        "box": [(485, 95, 805, 270), (480, 280, 715, 485), (990, 195, 1070, 290)]
    },
    "Throwing_seating_cartons_t01": {
        "box": [(485, 95, 810, 270), (480, 290, 720, 490), (990, 195, 1070, 290)]
    },
    "Throwing_seating_cartons_t02": {
        "box": [(485, 95, 810, 270), (485, 295, 720, 490), (990, 195, 1070, 290)]
    },
    "Throwing_seating_cartons_t03": {
        "box": [(485, 95, 810, 270), (480, 340, 690, 440), (990, 195, 1070, 290)]
    },
    "Throwing_seating_cartons_t04": {
        "box": [(485, 95, 810, 270), (485, 225, 685, 390), (480, 390, 705, 520)]
    },
    "Throwing_seating_cartons_t05": {
        "box": [(560, 95, 810, 225), (460, 390, 705, 530)]
    },
    "Throwing_seating_cartons_t06": {
        "box": [(520, 115, 850, 270), (490, 345, 670, 440)]
    },
    "Throwing_seating_cartons_t07": {"box": [(500, 115, 850, 390)]},
}
