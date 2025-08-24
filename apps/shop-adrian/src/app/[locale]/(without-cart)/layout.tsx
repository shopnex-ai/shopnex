import { type ReactNode } from "react";

import { Header } from "@/globals/Header/Component";

const WithoutCartLayout = ({ children }: { children: ReactNode }) => {
  return (
    <>
      <Header disableCart />
      {children}
    </>
  );
};
export default WithoutCartLayout;
