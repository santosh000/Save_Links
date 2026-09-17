// Result-count label for the Saved Links pagination footer.
// `count` is the number of results the pagination runs on (the filtered set),
// `page` is 1-based, `pageSize` is the existing ITEMS_PER_PAGE value.
export function paginationLabel(count, page, pageSize) {
  if (count === 0) return 'Showing 0 of 0 links'
  const start = Math.min((page - 1) * pageSize + 1, count)
  const end = Math.min(page * pageSize, count)
  return start === end
    ? `Showing ${start} of ${count} links`
    : `Showing ${start}\u2013${end} of ${count} links`
}
