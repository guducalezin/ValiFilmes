const token = "529da9acd613eb56ba170b16e863f9d2";

fetch("https://api.themoviedb.org/3/movie/popular?language=pt-BR", {
    method: "GET",
    headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`
    }
})
.then(response => response.json())
.then(data => {
    console.log(data);
})
.catch(error => {
    console.error("Erro:", error);
});