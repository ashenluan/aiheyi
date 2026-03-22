"use client";

import Sidebar from "../components/Sidebar";
import GridExpandModal from "../components/GridExpandModal";

export default function GridExpandPage() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <GridExpandModal />
    </div>
  );
}
