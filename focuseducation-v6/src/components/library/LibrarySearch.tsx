import { useState, useCallback, useEffect } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type SortOption = "newest" | "oldest" | "title" | "size";

interface LibrarySearchProps {
  onSearch:    (q: string)           => void;
  onSort:      (s: SortOption)       => void;
  sortValue:   SortOption;
  totalItems:  number;
}

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Più recenti",
  oldest: "Più vecchi",
  title:  "A–Z",
  size:   "Dimensione",
};

export function LibrarySearch({ onSearch, onSort, sortValue, totalItems }: LibrarySearchProps) {
  const [value, setValue]         = useState("");
  const [showSort, setShowSort]   = useState(false);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => onSearch(value.trim()), 280);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  const clear = useCallback(() => { setValue(""); onSearch(""); }, [onSearch]);

  return (
    <div className="space-y-2 mb-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Cerca per titolo o argomento..."
            className="pl-9 pr-8"
          />
          {value && (
            <button
              onClick={clear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowSort((p) => !p)}
          className={showSort ? "border-primary text-primary" : ""}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {showSort && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SORT_LABELS) as SortOption[]).map((s) => (
            <Badge
              key={s}
              variant={sortValue === s ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => { onSort(s); setShowSort(false); }}
            >
              {SORT_LABELS[s]}
            </Badge>
          ))}
        </div>
      )}

      {(value || sortValue !== "newest") && (
        <p className="text-xs text-muted-foreground">
          {totalItems} {totalItems === 1 ? "risultato" : "risultati"}
          {value && <> per "<strong>{value}</strong>"</>}
          {sortValue !== "newest" && <> · Ordine: {SORT_LABELS[sortValue]}</>}
        </p>
      )}
    </div>
  );
}
