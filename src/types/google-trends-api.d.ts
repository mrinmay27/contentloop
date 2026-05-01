declare module "google-trends-api" {
  const googleTrends: {
    relatedQueries(options: { keyword: string; geo?: string }): Promise<string>;
  };
  export default googleTrends;
}
