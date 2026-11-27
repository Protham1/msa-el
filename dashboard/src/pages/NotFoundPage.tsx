import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/States";

export default function NotFoundPage() {
  return (
    <div className="panel">
      <EmptyState
        icon={<Compass size={20} />}
        title="Page not found"
        message="The link may be incomplete, or the page may have moved. Return to the overview or browse recent traces."
        action={
          <>
            <Link className="secondary-button" to="/">Back to overview</Link>
            <Link className="secondary-button" to="/traces">Browse traces</Link>
          </>
        }
      />
    </div>
  );
}
