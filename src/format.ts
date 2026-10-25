const MEDIA_LABELS: Record<string, string> = {
  tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', tv_special: 'TV Special',
};

/** MAL enum values for display: tv → TV, light_novel → Light novel, null → ?. */
export const pretty = (value: string | null) => (value == null ? '?' : MEDIA_LABELS[value] ?? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

export const fmtNumber = (n: number) => n.toLocaleString('id-ID');
