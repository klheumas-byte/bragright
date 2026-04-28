export default function ButtonLoadingText({ isLoading, loadingText, children }) {
  return isLoading ? loadingText : children;
}
