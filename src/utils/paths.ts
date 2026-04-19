export const withBase = (path: string) => {
    let base = import.meta.env.BASE_URL || '/';
    if (base.endsWith('/')) base = base.slice(0, -1);
    if (!path.startsWith('/')) path = '/' + path;
    return base + path;
};
