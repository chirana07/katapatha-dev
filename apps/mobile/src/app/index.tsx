import { Redirect } from "expo-router";

/**
 * The entry route sends everyone into the driver group, whose layout owns the
 * guard. Keeping the decision in one place means there is one answer to "is this
 * driver signed in" rather than two that can disagree.
 */
export default function Index() {
  return <Redirect href="/(driver)" />;
}
