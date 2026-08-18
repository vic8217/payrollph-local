export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function normalizePagination(page, pageSize) {
  const parsedPage = Math.trunc(Number(page));
  const parsedPageSize = Math.trunc(Number(pageSize));
  return {
    page: Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
    pageSize: Number.isFinite(parsedPageSize) && parsedPageSize >= 1
      ? Math.min(MAX_PAGE_SIZE, parsedPageSize)
      : DEFAULT_PAGE_SIZE,
  };
}
