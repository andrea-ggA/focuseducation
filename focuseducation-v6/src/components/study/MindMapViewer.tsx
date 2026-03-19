import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { X, Info, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface MindMapNode {
  id: string;
  label: string;
  description: string;
  group: string;
  importance?: number; // 3=root, 2=primary, 1=detail
}

interface MindMapEdge {
  from: string;
  to: string;
  label?: string;
}

interface MindMapViewerProps {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  onBack: () => void;
}

// Vibrant, high-contrast ADHD-friendly palette
const PALETTE = [
  { bg: "#6366f1", light: "#a5b4fc" }, // indigo
  { bg: "#f59e0b", light: "#fcd34d" }, // amber
  { bg: "#10b981", light: "#6ee7b7" }, // emerald
  { bg: "#ef4444", light: "#fca5a5" }, // red
  { bg: "#8b5cf6", light: "#c4b5fd" }, // violet
  { bg: "#06b6d4", light: "#67e8f9" }, // cyan
  { bg: "#f97316", light: "#fdba74" }, // orange
  { bg: "#ec4899", light: "#f9a8d4" }, // pink
];

const ROOT_COLOR = { bg: "#3b82f6", light: "#93c5fd" }; // blue for root

function getGroupColorMap(groups: string[]): Record<string, typeof PALETTE[0]> {
  const map: Record<string, typeof PALETTE[0]> = {};
  groups.forEach((g, i) => {
    map[g] = PALETTE[i % PALETTE.length];
  });
  return map;
}

// Radial hierarchical layout: root center, primary ring, detail ring
function calculateRadialLayout(
  nodes: MindMapNode[],
  edges: MindMapEdge[],
  width: number,
  height: number
) {
  const positions: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return positions;

  const cx = width / 2;
  const cy = height / 2;

  // Find root (importance 3), primary (2), detail (1)
  const root = nodes.find((n) => n.importance === 3) || nodes[0];
  const primary = nodes.filter((n) => n.id !== root.id && (n.importance === 2 || n.importance === 3));
  const detail = nodes.filter((n) => n.id !== root.id && n.importance !== 2 && n.importance !== 3);

  // If no hierarchy data, treat first node as root, connected as primary, rest as detail
  let primaryNodes = primary.length > 0 ? primary : [];
  let detailNodes = detail;

  if (primaryNodes.length === 0) {
    // Infer from edges: nodes directly connected to root are primary
    const rootEdges = edges.filter((e) => e.from === root.id || e.to === root.id);
    const connectedIds = new Set(rootEdges.map((e) => (e.from === root.id ? e.to : e.from)));
    primaryNodes = nodes.filter((n) => n.id !== root.id && connectedIds.has(n.id));
    detailNodes = nodes.filter((n) => n.id !== root.id && !connectedIds.has(n.id));
  }

  // Root at center
  positions[root.id] = { x: cx, y: cy };

  // Primary ring
  const r1 = Math.min(width, height) * 0.25;
  primaryNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(primaryNodes.length, 1) - Math.PI / 2;
    positions[node.id] = {
      x: cx + r1 * Math.cos(angle),
      y: cy + r1 * Math.sin(angle),
    };
  });

  // Detail ring — place near their parent (connected primary node)
  const r2 = Math.min(width, height) * 0.42;
  // Group details by their connected primary
  const parentMap: Record<string, string[]> = {};
  detailNodes.forEach((dn) => {
    const edge = edges.find(
      (e) =>
        (e.from === dn.id && primaryNodes.some((p) => p.id === e.to)) ||
        (e.to === dn.id && primaryNodes.some((p) => p.id === e.from))
    );
    const parentId = edge
      ? primaryNodes.some((p) => p.id === edge.from)
        ? edge.from
        : edge.to
      : primaryNodes[0]?.id || root.id;
    if (!parentMap[parentId]) parentMap[parentId] = [];
    parentMap[parentId].push(dn.id);
  });

  Object.entries(parentMap).forEach(([parentId, childIds]) => {
    const parentPos = positions[parentId];
    if (!parentPos) return;
    const baseAngle = Math.atan2(parentPos.y - cy, parentPos.x - cx);
    const spread = Math.PI * 0.4; // fan spread
    childIds.forEach((childId, i) => {
      const offset = childIds.length === 1 ? 0 : ((i / (childIds.length - 1)) - 0.5) * spread;
      const angle = baseAngle + offset;
      positions[childId] = {
        x: cx + r2 * Math.cos(angle),
        y: cy + r2 * Math.sin(angle),
      };
    });
  });

  // Fallback for any unpositioned nodes
  const unpositioned = nodes.filter((n) => !positions[n.id]);
  unpositioned.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(unpositioned.length, 1);
    positions[node.id] = {
      x: cx + r2 * Math.cos(angle),
      y: cy + r2 * Math.sin(angle),
    };
  });

  return positions;
}

// Curved path between two points
function curvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // Perpendicular offset for curve
  const offset = Math.sqrt(dx * dx + dy * dy) * 0.15;
  const cx1 = mx - dy * 0.15;
  const cy1 = my + dx * 0.15;
  return `M ${x1} ${y1} Q ${cx1} ${cy1} ${x2} ${y2}`;
}

function nodeRadius(importance?: number): number {
  if (importance === 3) return 42;
  if (importance === 2) return 32;
  return 22;
}

function fontSize(importance?: number): number {
  if (importance === 3) return 13;
  if (importance === 2) return 11;
  return 9;
}

const MindMapViewer = ({ nodes, edges, onBack }: MindMapViewerProps) => {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const WIDTH = 1000;
  const HEIGHT = 700;

  const positions = useMemo(() => calculateRadialLayout(nodes, edges, WIDTH, HEIGHT), [nodes, edges]);
  const groups = useMemo(() => [...new Set(nodes.map((n) => n.group))], [nodes]);
  const colorMap = useMemo(() => getGroupColorMap(groups), [groups]);

  const root = useMemo(() => nodes.find((n) => n.importance === 3) || nodes[0], [nodes]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.4));
  const handleReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.4, Math.min(3, z - e.deltaY * 0.001)));
  }, []);

  // Connected nodes for highlighting
  const connectedTo = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const set = new Set<string>();
    edges.forEach((e) => {
      if (e.from === selectedNode) set.add(e.to);
      if (e.to === selectedNode) set.add(e.from);
    });
    return set;
  }, [selectedNode, edges]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-card-foreground">🧠 Mappa Concettuale</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomOut}><ZoomOut className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleZoomIn}><ZoomIn className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleReset}><Maximize2 className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={onBack}><X className="h-4 w-4 mr-1" /> Chiudi</Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {groups.map((g) => (
          <span key={g} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="w-3.5 h-3.5 rounded-full shadow-sm" style={{ backgroundColor: colorMap[g]?.bg }} />
            {g}
          </span>
        ))}
      </div>

      {/* Map Canvas */}
      <div
        className="overflow-hidden border border-border rounded-2xl bg-secondary/10 relative select-none"
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <svg
          ref={svgRef}
          width="100%"
          height={560}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="min-w-[600px]"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: "center center",
          }}
        >
          <defs>
            {/* Glow filter for root */}
            <filter id="glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Shadow filter */}
            <filter id="nodeShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
            </filter>
          </defs>

          {/* Edges — curved */}
          {edges.map((edge, i) => {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) return null;

            const isHighlighted = selectedNode && (edge.from === selectedNode || edge.to === selectedNode);
            const isDimmed = selectedNode && !isHighlighted;

            const path = curvedPath(from.x, from.y, to.x, to.y);
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;

            return (
              <g key={`edge-${i}`} style={{ opacity: isDimmed ? 0.15 : 1, transition: "opacity 0.3s" }}>
                <path
                  d={path}
                  fill="none"
                  stroke={isHighlighted ? "hsl(var(--primary))" : "hsl(var(--border))"}
                  strokeWidth={isHighlighted ? 2.5 : 1.5}
                  strokeDasharray={isHighlighted ? undefined : "none"}
                  opacity={0.7}
                />
                {edge.label && (
                  <g>
                    <rect
                      x={mx - edge.label.length * 3 - 4}
                      y={my - 9}
                      width={edge.label.length * 6 + 8}
                      height={16}
                      rx={8}
                      fill="hsl(var(--background))"
                      opacity={0.85}
                    />
                    <text
                      x={mx}
                      y={my + 2}
                      textAnchor="middle"
                      fontSize="8"
                      fill="hsl(var(--muted-foreground))"
                      fontFamily="system-ui"
                      fontWeight="500"
                    >
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = positions[node.id];
            if (!pos) return null;

            const isRoot = node.id === root?.id;
            const color = isRoot ? ROOT_COLOR : colorMap[node.group] || PALETTE[0];
            const r = nodeRadius(node.importance);
            const fs = fontSize(node.importance);
            const isSelected = selectedNode === node.id;
            const isConnected = connectedTo.has(node.id);
            const isDimmed = selectedNode && !isSelected && !isConnected;

            // Word wrap for label
            const words = node.label.split(" ");
            const lines: string[] = [];
            if (words.length <= 2) {
              lines.push(node.label);
            } else {
              lines.push(words.slice(0, 2).join(" "));
              lines.push(words.slice(2).join(" "));
            }

            return (
              <g
                key={node.id}
                className="cursor-pointer"
                style={{
                  opacity: isDimmed ? 0.2 : 1,
                  transition: "opacity 0.3s, transform 0.2s",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNode(isSelected ? null : node.id);
                }}
              >
                {/* Outer glow ring for root */}
                {isRoot && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={r + 8}
                    fill="none"
                    stroke={color.light}
                    strokeWidth={3}
                    opacity={0.4}
                    filter="url(#glow)"
                  />
                )}

                {/* Selection ring */}
                {isSelected && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={r + 5}
                    fill="none"
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2.5}
                    strokeDasharray="4 3"
                  >
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from={`0 ${pos.x} ${pos.y}`}
                      to={`360 ${pos.x} ${pos.y}`}
                      dur="8s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}

                {/* Node circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r}
                  fill={color.bg}
                  filter="url(#nodeShadow)"
                  stroke={isSelected ? "white" : color.light}
                  strokeWidth={isSelected ? 3 : 1.5}
                />

                {/* Label */}
                {lines.map((line, li) => (
                  <text
                    key={li}
                    x={pos.x}
                    y={pos.y + (li - (lines.length - 1) / 2) * (fs + 2)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fs}
                    fontWeight="700"
                    fill="white"
                    fontFamily="system-ui"
                    style={{ pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
                  >
                    {line.length > 14 ? line.substring(0, 13) + "…" : line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>

        {/* Hint */}
        <div className="absolute bottom-2 left-3 text-[10px] text-muted-foreground/60">
          Scroll per zoom · Trascina per spostare · Clicca un nodo per dettagli
        </div>
      </div>

      {/* Selected node detail panel */}
      <AnimatePresence>
        {selectedNode && (() => {
          const node = nodes.find((n) => n.id === selectedNode);
          if (!node) return null;
          const isRoot = node.id === root?.id;
          const color = isRoot ? ROOT_COLOR : colorMap[node.group] || PALETTE[0];
          const connections = edges.filter((e) => e.from === node.id || e.to === node.id);
          const connectedNodes = connections.map((e) => {
            const otherId = e.from === node.id ? e.to : e.from;
            return { node: nodes.find((n) => n.id === otherId), label: e.label };
          }).filter((c) => c.node);

          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="bg-card border border-border rounded-2xl p-5 shadow-lg"
            >
              <div className="flex items-start gap-4">
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                  style={{ backgroundColor: color.bg }}
                >
                  <Info className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-card-foreground text-lg">{node.label}</h3>
                    {isRoot && (
                      <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        CONCETTO CENTRALE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{node.group}</p>
                  <p className="text-sm text-card-foreground leading-relaxed">{node.description}</p>

                  {/* Connected concepts */}
                  {connectedNodes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs font-semibold text-muted-foreground mb-2">🔗 Connesso a:</p>
                      <div className="flex flex-wrap gap-2">
                        {connectedNodes.map((c, i) => (
                          <button
                            key={i}
                            className="text-xs px-2.5 py-1 rounded-full border border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors text-card-foreground"
                            onClick={() => setSelectedNode(c.node!.id)}
                          >
                            {c.node!.label}
                            {c.label && <span className="text-muted-foreground ml-1">({c.label})</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

export default MindMapViewer;
