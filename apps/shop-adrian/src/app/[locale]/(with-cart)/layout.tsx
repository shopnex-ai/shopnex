import { type ReactNode } from "react";

import { SynchronizeCart } from "@/components/(ecommerce)/Cart/SynchronizeCart";
import { Cart } from "@/globals/(ecommerce)/Layout/Cart/Component";
import { WishList } from "@/globals/(ecommerce)/Layout/WishList/Component";
import { Header } from "@/globals/Header/Component";

const CartLayout = ({ children }: { children: ReactNode }) => {
  return (
    <>
      <SynchronizeCart />
      <Header />
      <Cart />
      <WishList />
      {children}
    </>
  );
};
export default CartLayout;
