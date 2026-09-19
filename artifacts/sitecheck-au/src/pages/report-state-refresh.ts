export function refreshReportState(
  queryClient: { invalidateQueries(options: { queryKey: readonly unknown[] }): unknown },
  keys: {
    inspection: readonly unknown[];
    readiness: readonly unknown[];
    history: readonly unknown[];
  },
) {
  queryClient.invalidateQueries({ queryKey: keys.inspection });
  queryClient.invalidateQueries({ queryKey: keys.readiness });
  queryClient.invalidateQueries({ queryKey: keys.history });
}