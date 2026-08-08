// The clock hands. NOT part of the library.
//
// Transcribed from the inline data in the 2012 `clock.html`, converted to the v2 drawable schema.
// The three labeled segments run outward along a single radial line: "hour" near the center,
// "minute" further out, "second" much further out again -- which works because there is
// exponentially more room the further out you go.

export const CLOCK_HANDS = [
  {
    type: "path",
    points: [
      [0.0, 0.01673111, "L"], [0.0, 0.6],
      [0.0, 0.9, "L"], [0.0, 1.75],
      [0.0, 2.55, "L"], [0.0, 15.0],
      [0.0, 22.0, "L"], [0.0, 36.0],
    ],
    closed: false,
    stroke: "#990000",
    lineWidth: 3.0,
  },
  {
    // The little circle at the center.
    type: "path",
    points: [
      [0.05, -0.03314517, "L"], [0.0452134, -0.05452093, "L"], [0.03358215, -0.07018942, "L"],
      [0.01898142, -0.07941633, "L"], [0.0, -0.08314517, "L"], [-0.02001435, -0.07897846, "L"],
      [-0.03323666, -0.07049991, "L"], [-0.0444685, -0.05602747, "L"], [-0.05, -0.03314517, "L"],
      [-0.04499175, -0.01130758, "L"], [-0.03584449, 0.0017142, "L"], [-0.02073447, 0.01236639, "L"],
      [0.0, 0.01685483, "L"], [0.02542647, 0.0099162, "L"], [0.03827542, -0.000972107, "L"],
      [0.04723795, -0.01671535, "L"],
    ],
    closed: true,
    stroke: "#990000",
    lineWidth: 3.0,
  },
  {
    type: "text", text: "hour", at: [0.0, 0.75], up: [-0.07985780575310143, 0.7598504661183674],
    fill: "#990000", baseline: "middle", align: "center",
  },
  {
    type: "text", text: "minute", at: [0.0, 2.1], up: [-0.0428209044852465, 2.122820381035349],
    fill: "#990000", baseline: "middle", align: "center",
  },
  {
    type: "text", text: "second", at: [0.0, 17.999999999999642], up: [-0.005519827058329906, 18.17938308996018],
    fill: "#990000", baseline: "middle", align: "center",
  },
  {
    // The arrowhead at the far end.
    type: "path",
    points: [
      [-0.0015338994010362572, 31.876626207641685, "L"],
      [1.335751600398825e-5, 37.84649229598714, "L"],
      [0.0016135046631591753, 31.886213059436013, "L"],
      [2.662978600275102e-5, 33.38399286357155, "L"],
    ],
    closed: true,
    stroke: "none",
    fill: "#990000",
  },
];
