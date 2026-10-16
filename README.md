# web-caligrama

Web para crear caligramas al estilo de Vicente Huidobro: dibujas sobre la hoja y el texto que escribes se reparte a lo largo de tus líneas. El resultado se descarga como PDF tamaño carta o se imprime.

## Cómo usar

Abre `index.html` en el navegador (no necesita instalación; las fuentes y la librería de PDF se cargan desde internet).

- **Formato**: *Hoja completa*, *Tarjeta* (la hoja con una línea al medio para doblarla) o *4 postales* (la hoja dividida en cuatro con líneas de corte). En tarjeta y postales, cada trazo y su texto se quedan dentro de la parte donde empezaste a dibujar. En *Tarjeta* cada mitad tiene su propio poema (contraportada arriba y portada abajo) y en *4 postales* cada postal tiene el suyo.
- **Rotar**: el botón al lado de la hoja la gira 90° junto con el dibujo.
- **Tarjeta vertical**: la hoja se ve siempre como se imprime, con la mitad de arriba dada vuelta para que al doblar quede derecha. El botón *Dar vuelta* gira la vista 180° para ver y dibujar esa mitad derecha.
- Dibuja libremente sobre la hoja con el mouse o el dedo. El texto sigue los trazos en el orden y la dirección en que los dibujas; si un trazo termina cerca de donde empezó, se cierra.
- **Deshacer** / **Borrar todo** para corregir.
- El tamaño de letra se ajusta solo para que el texto recorra todo el dibujo; con "Repetir el texto" lo eliges tú.

## Archivos

- `index.html` — estructura y controles
- `style.css` — estilos
- `script.js` — dibujo a mano, acomodo del texto sobre los trazos y exportación a PDF
