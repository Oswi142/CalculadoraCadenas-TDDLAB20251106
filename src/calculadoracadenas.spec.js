import sumarCadena from "./calculadoracadenas.js";

describe("Calculadora de cadenas", () => {
  it("deberia retornar 0 para una cadena vacia", () => {
    expect(sumarCadena("")).toEqual(0);
  });

  it("deberia retornar el numero  para una cadena de solo un numero", () => {
    expect(sumarCadena("3")).toEqual(3);
  });
});
