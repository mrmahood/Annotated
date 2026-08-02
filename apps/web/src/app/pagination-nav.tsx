import Link from "next/link";
import { getPageHref, getPagination } from "@/lib/public-content";

export function PaginationNav({
  basePath,
  page,
  hasNext,
}: {
  basePath: string;
  page: number;
  hasNext: boolean;
}) {
  const { previousPage, nextPage } = getPagination(page, hasNext);

  return (
    <nav className="pagination" aria-label="Annotation pages">
      {previousPage ? (
        <Link rel="prev" href={getPageHref(basePath, previousPage)}>
          Previous
        </Link>
      ) : (
        <span aria-disabled="true">Previous</span>
      )}
      <span className="pagination-current">Page {page.toLocaleString()}</span>
      {nextPage ? (
        <Link rel="next" href={getPageHref(basePath, nextPage)}>
          Next
        </Link>
      ) : (
        <span aria-disabled="true">Next</span>
      )}
    </nav>
  );
}
