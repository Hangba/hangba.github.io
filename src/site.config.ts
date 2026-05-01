import { withBase } from "./utils/helpers";

export type Image = {
    src: string;
    alt?: string;
    caption?: string;
};

export type Link = {
    text: string;
    href: string;
};

export type Hero = {
    eyebrowText?: string;
    title?: string;
    titleLines?: string[];
    text?: string;
    image?: Image;
    actions?: Link[];
};

export type About = {
    title?: string;
    text?: string;
};

export type Blog = {
    description?: string;
};

export type ContactInfo = {
    title?: string;
    text?: string;
    email?: {
        text?: string;
        href?: string;
        email?: string;
    };
    socialProfiles?: {
        text?: string;
        href?: string;
    }[];
};

export type SiteConfig = {
    website: string;
    logo?: Image;
    title: string;
    description: string;
    image?: Image;
    headerNavLinks?: Link[];
    footerNavLinks?: Link[];
    socialLinks?: Link[];
    hero?: Hero;
    about?: About;
    contactInfo?: ContactInfo;
    blog?: Blog;
    postsPerPage?: number;
    recentPostLimit: number;
    projectsPerPage?: number;
};

const siteConfig: SiteConfig = {
    website: 'https://hangba.github.io',
    title: 'HangbaSteve\'s Blog',
    description: 'HangbaSteve的个人Blog',
    headerNavLinks: [
        {
            text: 'Home',
            href: withBase('/')
        },
        {
            text: 'Blog',
            href: withBase('/blog')
        },
        {
            text: 'Tags',
            href: withBase('/tags')
        },
        {
            text: 'Friends',
            href: withBase('/friends')
        },
        {
            text: 'About',
            href: withBase('/about')
        }
    ],
    footerNavLinks: [
        {
            text: 'About',
            href: withBase('/about')
        },
        {
            text: 'RSS Feed',
            href: withBase('/rss.xml')
        },
                {
            text: 'Sitemap',
            href: withBase('/sitemap-index.xml')
        }
    ],
    hero: {
        eyebrowText: '欢迎来到',
        title: 'HangbaSteve\'s Blog',
        titleLines: ['HangbaSteve\'s', 'Blog'],
        text: "My God! It's full of stars!",
        image: {
            src: '/assets/images/pixeltrue-space-discovery.svg',
            alt: 'A person sitting at a desk in front of a computer'
        },
        actions: [
            {
                text: 'Read Now',
                href: withBase('/blog')
            }
        ]
    },
    about: {
        title: 'About',
        text: 'I\'m an undergraduate student major in Space Science and Technology at Harbin Institute of Technology, Shenzhen, with a concentration in planetary science. Whether you have a question, a suggestion, or just want to share your thoughts, I\'m all ears. Feel free to get in touch through the links below.',
    },
    blog: {
        description: "Explore the unknown."
    },
    postsPerPage: 5,
    recentPostLimit: 3
};

export default siteConfig;
