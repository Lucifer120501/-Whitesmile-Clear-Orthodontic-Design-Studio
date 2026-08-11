import React from "react";

interface AlignerLogoProps {
  className?: string;
  iconOnly?: boolean;
}

export const AlignerLogo: React.FC<AlignerLogoProps> = ({ className = "h-10", iconOnly = false }) => {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Stylized Whitesmile Clear Icon: Tooth + Leaf/Crescent (supports currentColor for positive/negative brand styles) */}
      <svg
        viewBox="0 0 100 100"
        className="w-10 h-10 shrink-0 select-none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Main outer swooshing leaf/crescent */}
        <path
          d="M20 35C20 20 40 10 65 15C50 18 35 28 30 42C25 55 30 70 45 80C32 78 22 68 20 55C18.5 45 18.5 38 20 35Z"
          fill="currentColor"
        />
        <path
          d="M30 75C45 88 70 85 82 70C90 60 92 45 85 30C87 45 83 60 72 70C62 80 45 82 30 75Z"
          fill="currentColor"
          opacity="0.8"
        />
        {/* Inner tooth structure */}
        <path
          d="M40 45C40 38 45 35 50 38C55 40 58 35 62 35C66 35 70 38 70 45C70 58 60 70 55 75C53 72 40 58 40 45Z"
          fill="currentColor"
        />
        {/* Accent highlight */}
        <path
          d="M48 40C45 42 43 45 43 48"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>

      {!iconOnly && (
        <div className="flex flex-col text-left">
          <span className="font-sans font-extrabold tracking-tight text-white leading-none text-base uppercase">
            Whitesmile Clear
          </span>
          <span className="font-sans font-medium tracking-[0.25em] text-white/80 uppercase text-[9px] mt-1.5 leading-none">
            ORTHODONTIC
          </span>
        </div>
      )}
    </div>
  );
};
