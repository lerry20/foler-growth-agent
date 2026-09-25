/** Shared button classes. Plain module so server components can use them as values. */
export const BTN = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-700 disabled:opacity-60",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60",
};
